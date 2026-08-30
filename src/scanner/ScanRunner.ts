import type { App } from "obsidian";
import type { Issue, ScanProgressCallback, ScanResult, ScannerId } from "./Issue";
import type { ScanContext } from "./ScanContext";
import type { InspectorSettings } from "../settings/settings";
import { buildReferenceIndex } from "./reference-index";

export type Scanner = {
	id: ScannerId;
	scan(ctx: ScanContext, onProgress?: ScanProgressCallback): Issue[] | Promise<Issue[]>;
};

export function getEffectiveIgnoredFolders(
	globalFolders: string[],
	scannerFolders: string[],
): string[] {
	return [...new Set([...globalFolders, ...scannerFolders])];
}

type RunOptions = {
	onProgress?: ScanProgressCallback;
};

export class ScanRunner {
	private scanners: Scanner[] = [];

	constructor(
		private requestUrl?: (url: string) => Promise<number>,
		private timers?: {
			setTimeout: (callback: () => void, delayMs: number) => unknown;
			clearTimeout: (timeoutId: unknown) => void;
		},
	) {}

	register(scanner: Scanner): void {
		this.scanners.push(scanner);
	}

	async run(app: App, settings: InspectorSettings, options: RunOptions = {}): Promise<ScanResult> {
		const startedAt = Date.now();
		const markdownFiles = app.vault.getMarkdownFiles();
		const allFiles = app.vault.getFiles();
		const filePathIndex = new Set(allFiles.map((f) => f.path));

		const referenceIndex = await buildReferenceIndex({
			metadataCache: app.metadataCache,
			vault: app.vault,
			markdownFiles,
			allFiles,
			filePathIndex,
		});

		const ctx: ScanContext = {
			app,
			metadataCache: app.metadataCache,
			vault: app.vault,
			requestUrl: this.requestUrl,
			setTimeout: this.timers?.setTimeout,
			clearTimeout: this.timers?.clearTimeout,
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
			ignoreUnresolvedNoteLinks: settings.ignoreUnresolvedNoteLinks,
			ignoredProperties: settings.ignoredProperties,
			emptyNoteWordThreshold: settings.emptyNoteWordThreshold,
			referenceIndex,
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
			const scannerContext: ScanContext = {
				...ctx,
				ignoredFolders: getEffectiveIgnoredFolders(
					settings.ignoredFolders,
					settings.ignoredFoldersByScanner[scanner.id] ?? [],
				),
			};
			const result = await scanner.scan(scannerContext, (progress) => {
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
