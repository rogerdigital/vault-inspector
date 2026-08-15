import { Plugin, Notice, TFile, requestUrl } from "obsidian";
import { InspectorView, VIEW_TYPE_INSPECTOR } from "./report/InspectorView";
import { ScanRunner } from "./scanner/ScanRunner";
import { registerDefaultScanners } from "./scanner/register-scanners";
import {
	createEmptyIgnoredFoldersByScanner,
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "./settings/settings";
import { InspectorSettingTab } from "./settings/settings-tab";
import { generateMarkdownReport } from "./report/markdown-export";
import { showLargeReportWarningModal } from "./report/export-warning-modal";
import {
	getReportExportPreflight,
	MAX_SAFE_VAULT_REPORT_BYTES,
} from "./report/report-export";
import { executeFixAction } from "./fix/fix-executor";
import { showConfirmModal } from "./fix/confirm-modal";
import { runFixBatch } from "./fix/fix-runner";
import type { DispositionOutcome } from "./fix/action-outcomes";
import { parsePluginData, type PersistedPluginData } from "./settings/plugin-data";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "./snapshot/scan-snapshot";
import { createScanProfile } from "./scanner/scan-profile";
import { compareScanResult } from "./scanner/result-diff";
import type { ScanResult } from "./scanner/Issue";
import { SCANNER_LABELS } from "./scanner/Issue";
import { openPluginSettings } from "./utils/open-plugin-settings";

export default class VaultInspectorPlugin extends Plugin {
	settings: InspectorSettings = DEFAULT_SETTINGS;
	lastSuccessfulSnapshot: ScanSnapshot | null = null;
	private saveQueue: Promise<void> = Promise.resolve();
	private operationQueue: Promise<void> = Promise.resolve();
	scanRunner = new ScanRunner(async (url) => {
		const response = await requestUrl({ url, method: "HEAD" });
		return response.status;
	}, {
		setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) => window.clearTimeout(timeoutId as number),
	});

	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_INSPECTOR, (leaf) => {
			const view = new InspectorView(leaf);
			this.configureView(view);
			return view;
		});
		this.addCommand({
			id: "run-scan",
			name: "Run scan",
			callback: () => this.runScan(),
		});
		this.addCommand({
			id: "export-report",
			name: "Export report",
			callback: () => this.exportReport(),
		});
		registerDefaultScanners(this.scanRunner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));

		this.addRibbonIcon("shield-check", "Run scan", () => this.runScan());
	}

	onunload() {}

	async loadSettings() {
		const parsed = parsePluginData(await this.loadData());
		const loaded = parsed.settings;
		this.settings = {
			...DEFAULT_SETTINGS,
			...loaded,
			enabledScanners: {
				...DEFAULT_SETTINGS.enabledScanners,
				...loaded.enabledScanners,
			},
			ignoredFoldersByScanner: {
				...createEmptyIgnoredFoldersByScanner(),
				...loaded.ignoredFoldersByScanner,
			},
		};
		this.lastSuccessfulSnapshot = parsed.lastSuccessfulSnapshot;

		if (migrateExcalidrawFrontmatterKey(this.settings, loaded)) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.persistPluginData();
	}

	private persistPluginData(options?: {
		acceptedSnapshot?: ScanSnapshot;
		settings?: InspectorSettings;
	}): Promise<void> {
		const write = this.saveQueue.catch(() => undefined).then(async () => {
			const snapshot = options?.acceptedSnapshot ?? this.lastSuccessfulSnapshot;
			const data: PersistedPluginData = {
				settings: structuredClone(options?.settings ?? this.settings),
				...(snapshot
					? { lastSuccessfulSnapshot: structuredClone(snapshot) }
					: {}),
			};
			await this.saveData(data);
			if (options?.acceptedSnapshot) {
				this.lastSuccessfulSnapshot = options.acceptedSnapshot;
			}
		});
		this.saveQueue = write;
		return write;
	}

	private async runScan() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR)[0];
		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_INSPECTOR, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);

		const view = leaf.view as unknown as InspectorView;
		this.configureView(view);
		await this.scanAndRender(view);
	}

	private configureView(view: InspectorView) {
		view.setCallbacks({
			onIgnoreAllIssues: (issues) => this.enqueueOperation(async () => {
				const requestedIssues = uniqueIssuesByFingerprint(issues);
				if (requestedIssues.length === 0) return;
				const fingerprints = requestedIssues.map((issue) => issue.fingerprint);
				const candidate = structuredClone(this.settings);
				candidate.ignoredIssueFingerprints = mergeUnique(
					candidate.ignoredIssueFingerprints,
					fingerprints,
				);
				try {
					await this.persistPluginData({ settings: candidate });
				} catch (error) {
					view.setOperationOutcomes(requestedIssues.map((issue): DispositionOutcome => ({
						fingerprint: issue.fingerprint,
						outcome: "failed",
						message: `Failed to ignore issue: ${errorMessage(error)}`,
						affectedPaths: getAffectedIssuePaths(issue),
					})));
					return;
				}
				this.settings.ignoredIssueFingerprints = mergeUnique(
					this.settings.ignoredIssueFingerprints,
					fingerprints,
				);
				await this.performScanAndRenderHandled(view);
				view.setOperationOutcomes(requestedIssues.map((issue): DispositionOutcome => ({
					fingerprint: issue.fingerprint,
					outcome: "ignored",
					message: `Ignored ${issue.title}`,
					affectedPaths: getAffectedIssuePaths(issue),
				})));
			}),
			onRestoreIssues: (issues) => this.enqueueOperation(async () => {
				const requestedIssues = uniqueIssuesByFingerprint(issues);
				if (requestedIssues.length === 0) return;
				const toRestore = new Set(requestedIssues.map((issue) => issue.fingerprint));
				const candidate = structuredClone(this.settings);
				candidate.ignoredIssueFingerprints = candidate.ignoredIssueFingerprints.filter(
					(fp) => !toRestore.has(fp),
				);
				try {
					await this.persistPluginData({ settings: candidate });
				} catch (error) {
					view.setOperationOutcomes(requestedIssues.map((issue): DispositionOutcome => ({
						fingerprint: issue.fingerprint,
						outcome: "failed",
						message: `Failed to restore issue: ${errorMessage(error)}`,
						affectedPaths: getAffectedIssuePaths(issue),
					})));
					return;
				}
				this.settings.ignoredIssueFingerprints = this.settings.ignoredIssueFingerprints.filter(
					(fp) => !toRestore.has(fp),
				);
				await this.performScanAndRenderHandled(view);
				view.setOperationOutcomes(requestedIssues.map((issue): DispositionOutcome => ({
					fingerprint: issue.fingerprint,
					outcome: "restored",
					message: `Restored ${issue.title}`,
					affectedPaths: getAffectedIssuePaths(issue),
				})));
			}),
			onFixAllIssues: async (issues) => {
				if (!issues.some((issue) => issue.fixAction)) return;
				const decisions = await showConfirmModal(
					this.app,
					issues,
					this.settings.duplicateKeepMode,
				);
				if (!decisions) return;
				await this.enqueueOperation(async () => {
					const fixSettings = structuredClone(this.settings);
					const scanProfile = await createScanProfile(fixSettings);
					const batch = await runFixBatch(issues, decisions, {
						scan: () => this.scan(view, structuredClone(fixSettings)),
						execute: (action) => executeFixAction(this.app, action),
					});
					let acceptanceFailed = false;
					let acceptanceError: unknown;
					if (batch.verificationResult) {
						try {
							await this.acceptScanResult(
								view,
								batch.verificationResult,
								scanProfile,
							);
						} catch (error) {
							acceptanceFailed = true;
							acceptanceError = error;
						}
					}
					if (acceptanceFailed) {
						try {
							view.setOperationOutcomes(batch.outcomes);
						} catch {
							throw acceptanceError;
						}
						throw acceptanceError;
					}
					view.setOperationOutcomes(batch.outcomes);
				});
			},
			onRevealIssue: async (issue) => {
				const path = issue.primaryPath ?? issue.relatedPaths[0];
				if (!path) return;
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await view.revealIssue(issue);
				} else {
					new Notice(`File not found: ${path}`);
				}
			},
			onRunScan: () => { void this.runScan(); },
			onIgnoreIssue: (issue) => this.enqueueOperation(async () => {
				const candidate = structuredClone(this.settings);
				candidate.ignoredIssueFingerprints = mergeUnique(
					candidate.ignoredIssueFingerprints,
					[issue.fingerprint],
				);
				const affectedPaths = getAffectedIssuePaths(issue);
				try {
					await this.persistPluginData({ settings: candidate });
				} catch (error) {
					view.setOperationOutcomes([{
						fingerprint: issue.fingerprint,
						outcome: "failed",
						message: `Failed to ignore issue: ${errorMessage(error)}`,
						affectedPaths,
					}]);
					return;
				}
				this.settings.ignoredIssueFingerprints = mergeUnique(
					this.settings.ignoredIssueFingerprints,
					[issue.fingerprint],
				);
				await this.performScanAndRenderHandled(view);
				view.setOperationOutcomes([{
					fingerprint: issue.fingerprint,
					outcome: "ignored",
					message: `Ignored ${issue.title}`,
					affectedPaths,
				}]);
			}),
			onExcludeFolder: (request) => this.enqueueOperation(async () => {
				const candidate = structuredClone(this.settings);
				candidate.ignoredFoldersByScanner[request.scannerId] = mergeUnique(
					candidate.ignoredFoldersByScanner[request.scannerId],
					[request.folder],
				);
				try {
					await this.persistPluginData({ settings: candidate });
				} catch (error) {
					view.setOperationOutcomes([{
						scannerId: request.scannerId,
						outcome: "failed",
						message: `Failed to exclude folder: ${errorMessage(error)}`,
						affectedPaths: [request.folder],
					}]);
					return;
				}
				this.settings.ignoredFoldersByScanner[request.scannerId] = mergeUnique(
					this.settings.ignoredFoldersByScanner[request.scannerId],
					[request.folder],
				);
				await this.performScanAndRenderHandled(view);
				view.setOperationOutcomes([{
					scannerId: request.scannerId,
					outcome: "excluded",
					message: `${SCANNER_LABELS[request.scannerId]} excluded ${request.folder}; ${request.affectedCount} affected finding(s).`,
					affectedPaths: [request.folder],
				}]);
			}),
			onOpenScannerSettings: () => {
				if (openPluginSettings(this.app, this.manifest.id)) return;
				new Notice([
					"Open Settings",
					"Vault Inspector",
					"Scanner-specific ignored folders.",
				].join(" → "));
			},
		});
		view.setEnableFixActions(this.settings.enableFixActions);
	}

	private scanAndRender(view: InspectorView): Promise<void> {
		return this.enqueueOperation(async () => {
			view.setOperationOutcomes([]);
			await this.performScanAndRenderHandled(view);
		});
	}

	private async performScanAndRenderHandled(view: InspectorView): Promise<void> {
		try {
			await this.performScanAndRender(view);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
		}
	}

	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const run = this.operationQueue
			.catch(() => undefined)
			.then(operation);
		this.operationQueue = run.catch(() => undefined);
		return run;
	}

	private async performScanAndRender(view: InspectorView) {
		const scanSettings = structuredClone(this.settings);
		const scanProfile = await createScanProfile(scanSettings);
		try {
			const result = await this.scan(view, scanSettings);
			if (!result) return;
			await this.acceptScanResult(view, result, scanProfile);
		} catch (error) {
			this.stopScanningBestEffort(view);
			throw error;
		}
	}

	private async acceptScanResult(
		view: InspectorView,
		result: ScanResult,
		scanProfile: string,
	) {
		const comparison = compareScanResult(
			result,
			this.lastSuccessfulSnapshot,
			scanProfile,
		);
		view.setResult(result, comparison);

		const nextSnapshot = createScanSnapshot(
			result,
			scanProfile,
			this.manifest.version,
		);
		try {
			await this.persistPluginData({ acceptedSnapshot: nextSnapshot });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(
				`Scan completed, but the comparison snapshot could not be saved: ${message}`,
			);
		}
	}

	private async scan(view: InspectorView, settings: InspectorSettings) {
		try {
			view.setScanning(true);
			return await this.scanRunner.run(this.app, settings, {
				onProgress: (progress) => view.setScanProgress(progress),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
			this.stopScanningBestEffort(view);
			return null;
		}
	}

	private stopScanningBestEffort(view: InspectorView) {
		try {
			view.setScanning(false);
		} catch {
			// Preserve the original scan outcome when view cleanup is unavailable.
		}
	}

	private async exportReport() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR);
		const view = leaves[0]?.view as unknown as InspectorView | undefined;
		if (!view || !view.hasResult()) {
			new Notice("Run a scan first before exporting.");
			return;
		}

		try {
			const result = view.getResult()!;
			const fullReport = generateMarkdownReport(result);
			const preflight = getReportExportPreflight(fullReport);
			let report = fullReport;
			let exportKind = "Report";
			if (preflight.requiresConfirmation) {
				const decision = await showLargeReportWarningModal(this.app, {
					reportBytes: preflight.byteLength,
					thresholdBytes: MAX_SAFE_VAULT_REPORT_BYTES,
					findingCount: result.issues.length,
				});
				if (!decision) return;
				if (decision === "summary") {
					report = generateMarkdownReport(result, "summary");
					exportKind = "Summary";
				}
			}

			const folder = this.settings.reportFolderPath;
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const filename = `Vault Inspector ${exportKind} ${timestamp}.md`;
			const filepath = `${folder}/${filename}`;
			if (!this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
			await this.app.vault.create(filepath, report);
			new Notice(`${exportKind} exported to ${filepath}`);
		} catch (error) {
			new Notice(`Report export failed: ${errorMessage(error)}`);
		}
	}
}

function getAffectedIssuePaths(issue: { primaryPath?: string; relatedPaths: string[] }): string[] {
	return [...new Set([
		...(issue.primaryPath ? [issue.primaryPath] : []),
		...issue.relatedPaths,
	])];
}

function uniqueIssuesByFingerprint<T extends { fingerprint: string }>(issues: T[]): T[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		if (seen.has(issue.fingerprint)) return false;
		seen.add(issue.fingerprint);
		return true;
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function mergeUnique(current: string[], additions: string[]): string[] {
	return [...new Set([...current, ...additions])];
}

const LEGACY_EXCALIDRAW_KEY = "excalidraw";
const EXCALIDRAW_FRONTMATTER_KEY = "excalidraw-plugin";

/**
 * Migrates the legacy `["excalidraw"]` entry in
 * `ignoredLargeMarkdownFrontmatterKeys` to the correct `excalidraw-plugin`
 * key the Excalidraw plugin actually writes. Only touches persisted values
 * (loaded from data.json), never DEFAULT_SETTINGS, so fresh installs and
 * untouched users are not needlessly rewritten.
 *
 * - `["excalidraw"]` → `["excalidraw-plugin"]` (replace in place)
 * - `["excalidraw", "excalidraw-plugin"]` → `["excalidraw-plugin"]` (dedup)
 * - `["excalidraw", "canvas"]` → `["excalidraw-plugin", "canvas"]`
 *
 * Returns true when settings were changed and should be persisted.
 */
export function migrateExcalidrawFrontmatterKey(
	settings: InspectorSettings,
	loaded: Partial<InspectorSettings> | null,
): boolean {
	const loadedKeys = loaded?.ignoredLargeMarkdownFrontmatterKeys;
	if (!loadedKeys || !loadedKeys.includes(LEGACY_EXCALIDRAW_KEY)) return false;

	const migrated = settings.ignoredLargeMarkdownFrontmatterKeys.map((k) =>
		k === LEGACY_EXCALIDRAW_KEY ? EXCALIDRAW_FRONTMATTER_KEY : k,
	);
	const deduped = Array.from(new Set(migrated));
	if (
		deduped.length === settings.ignoredLargeMarkdownFrontmatterKeys.length &&
		deduped.every((k, i) => k === settings.ignoredLargeMarkdownFrontmatterKeys[i])
	) {
		return false;
	}
	settings.ignoredLargeMarkdownFrontmatterKeys = deduped;
	return true;
}
