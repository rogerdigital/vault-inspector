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
import { executeFixAction } from "./fix/fix-executor";
import { showConfirmModal } from "./fix/confirm-modal";
import { getFreshFixAction } from "./fix/fix-decisions";
import { parsePluginData, type PersistedPluginData } from "./settings/plugin-data";
import type { ScanSnapshot } from "./snapshot/scan-snapshot";

export default class VaultInspectorPlugin extends Plugin {
	settings: InspectorSettings = DEFAULT_SETTINGS;
	lastSuccessfulSnapshot: ScanSnapshot | null = null;
	private saveQueue: Promise<void> = Promise.resolve();
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

	private persistPluginData(): Promise<void> {
		const write = this.saveQueue.catch(() => undefined).then(async () => {
			const data: PersistedPluginData = {
				settings: structuredClone(this.settings),
				...(this.lastSuccessfulSnapshot
					? { lastSuccessfulSnapshot: structuredClone(this.lastSuccessfulSnapshot) }
					: {}),
			};
			await this.saveData(data);
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
			onIgnoreAllIssues: async (issues) => {
				for (const issue of issues) {
					this.settings.ignoredIssueFingerprints.push(issue.fingerprint);
				}
				await this.saveSettings();
				new Notice(`Ignored ${issues.length} issue(s)`);
				await this.scanAndRender(view);
			},
			onRestoreIssues: async (issues) => {
				const toRestore = new Set(issues.map((i) => i.fingerprint));
				this.settings.ignoredIssueFingerprints = this.settings.ignoredIssueFingerprints.filter(
					(fp) => !toRestore.has(fp),
				);
				await this.saveSettings();
				new Notice(`Restored ${issues.length} issue(s)`);
				await this.scanAndRender(view);
			},
			onFixAllIssues: async (issues) => {
				if (!issues.some((issue) => issue.fixAction)) return;
				const decisions = await showConfirmModal(
					this.app,
					issues,
					this.settings.duplicateKeepMode,
				);
				if (!decisions) return;
				const decisionsByFingerprint = new Map(
					decisions.map((decision) => [decision.fingerprint, decision]),
				);

				let fixed = 0;
				let skipped = 0;
				for (const issue of issues) {
					const decision = decisionsByFingerprint.get(issue.fingerprint);
					if (!decision) {
						skipped++;
						continue;
					}
					const freshResult = await this.scan(view);
					if (!freshResult) return;
					const freshIssue = freshResult.issues.find(
						(candidate) => candidate.fingerprint === issue.fingerprint,
					);
					const freshAction = getFreshFixAction(issue, freshIssue, decision);
					if (!freshAction) {
						skipped++;
						continue;
					}
					try {
						fixed += await executeFixAction(this.app, freshAction);
					} catch {
						// continue on individual failures
					}
				}
				new Notice(formatFixResultNotice(fixed, skipped));
				await this.scanAndRender(view);
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
		});
		view.setEnableFixActions(this.settings.enableFixActions);
	}

	private async scanAndRender(view: InspectorView) {
		const result = await this.scan(view);
		if (result) view.setResult(result);
	}

	private async scan(view: InspectorView) {
		view.setScanning(true);
		try {
			return await this.scanRunner.run(this.app, this.settings, {
				onProgress: (progress) => view.setScanProgress(progress),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
			view.setScanning(false);
			return null;
		}
	}

	private async exportReport() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR);
		const view = leaves[0]?.view as unknown as InspectorView | undefined;
		if (!view || !view.hasResult()) {
			new Notice("Run a scan first before exporting.");
			return;
		}

		const result = view.getResult()!;
		const report = generateMarkdownReport(result);
		const folder = this.settings.reportFolderPath;
		const now = new Date();
		const filename = `Vault Inspector Report ${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`;
		const filepath = `${folder}/${filename}`;

		await this.app.vault.createFolder(folder).catch(() => {});
		await this.app.vault.create(filepath, report);
		new Notice(`Report exported to ${filepath}`);
	}
}

export function formatFixResultNotice(fixed: number, skipped: number): string {
	const fixedText = fixed > 0
		? `Fixed ${fixed} item${fixed === 1 ? "" : "s"}`
		: "No items were fixed";
	if (skipped === 0) return fixedText;
	return `${fixedText}; skipped ${skipped} changed ${skipped === 1 ? "issue" : "issues"}`;
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
