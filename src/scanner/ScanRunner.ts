import type { App } from "obsidian";
import type { Issue, ScanProgressCallback, ScanResult, ScannerId } from "./Issue";
import type { ScanContext } from "./ScanContext";
import type { InspectorSettings } from "../settings/settings";

export type Scanner = {
	id: ScannerId;
	scan(ctx: ScanContext, onProgress?: ScanProgressCallback): Issue[] | Promise<Issue[]>;
};

type RunOptions = {
	onProgress?: ScanProgressCallback;
};

export class ScanRunner {
	private scanners: Scanner[] = [];

	constructor(private requestUrl?: (url: string) => Promise<number>) {}

	register(scanner: Scanner): void {
		this.scanners.push(scanner);
	}

	async run(app: App, settings: InspectorSettings, options: RunOptions = {}): Promise<ScanResult> {
		const startedAt = Date.now();
		const markdownFiles = app.vault.getMarkdownFiles();
		const allFiles = app.vault.getFiles();
		const filePathIndex = new Set(allFiles.map((f) => f.path));

		const ctx: ScanContext = {
			app,
			metadataCache: app.metadataCache,
			vault: app.vault,
			requestUrl: this.requestUrl,
			markdownFiles,
			allFiles,
			filePathIndex,
			enabledScanners: new Set(
				Object.entries(settings.enabledScanners)
					.filter(([, enabled]) => enabled)
					.map(([id]) => id as ScannerId),
			),
			ignoredFingerprints: new Set(settings.ignoredIssueFingerprints),
			largeMarkdownBytes: settings.largeMarkdownBytes,
			largeAttachmentBytes: settings.largeAttachmentBytes,
			ignoredLargeMarkdownFrontmatterKeys:
				settings.ignoredLargeMarkdownFrontmatterKeys,
			ignoredLargeMarkdownPathPatterns:
				settings.ignoredLargeMarkdownPathPatterns,
			duplicateHashMaxBytes: settings.duplicateHashMaxBytes,
			lowUsageTagThreshold: settings.lowUsageTagThreshold,
			watchedTags: settings.watchedTags,
			ignoredFolders: settings.ignoredFolders,
			ignoredProperties: settings.ignoredProperties,
			emptyNoteWordThreshold: settings.emptyNoteWordThreshold,
		};

		const scannersRun: ScannerId[] = [];
		const issues: Issue[] = [];
		const ignoredIssues: Issue[] = [];

		for (let index = 0; index < this.scanners.length; index++) {
			const scanner = this.scanners[index];
			const scannerIndex = index + 1;
			const scannerTotal = this.scanners.length;
			const emitProgress = (type: Parameters<ScanProgressCallback>[0]["type"], message?: string) => {
				options.onProgress?.({
					type,
					scannerId: scanner.id,
					scannerIndex,
					scannerTotal,
					message,
					elapsedMs: Date.now() - startedAt,
				});
			};

			if (!ctx.enabledScanners.has(scanner.id)) {
				emitProgress("scanner-skipped", "disabled");
				continue;
			}
			scannersRun.push(scanner.id);
			emitProgress("scanner-start");
			const result = await scanner.scan(ctx, (progress) => {
				options.onProgress?.({
					...progress,
					scannerId: scanner.id,
					scannerIndex,
					scannerTotal,
					elapsedMs: Date.now() - startedAt,
				});
			});
			for (const issue of result) {
				if (ctx.ignoredFingerprints.has(issue.fingerprint)) {
					ignoredIssues.push(issue);
				} else {
					issues.push(issue);
				}
			}
			emitProgress("scanner-complete");
		}

		return {
			startedAt,
			finishedAt: Date.now(),
			issues,
			ignoredIssues,
			filesScanned: allFiles.length,
			scannersRun,
		};
	}
}
