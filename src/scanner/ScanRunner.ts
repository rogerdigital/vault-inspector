import type { App } from "obsidian";
import type { Issue, ScanResult, ScannerId } from "./Issue";
import type { ScanContext } from "./ScanContext";
import type { InspectorSettings } from "../settings/settings";

export type Scanner = {
	id: ScannerId;
	scan(ctx: ScanContext): Issue[];
};

export class ScanRunner {
	private scanners: Scanner[] = [];

	register(scanner: Scanner): void {
		this.scanners.push(scanner);
	}

	async run(app: App, settings: InspectorSettings): Promise<ScanResult> {
		const startedAt = Date.now();
		const markdownFiles = app.vault.getMarkdownFiles();
		const allFiles = app.vault.getFiles();
		const filePathIndex = new Set(allFiles.map((f) => f.path));

		const ctx: ScanContext = {
			app,
			metadataCache: app.metadataCache,
			vault: app.vault,
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
			duplicateHashMaxBytes: settings.duplicateHashMaxBytes,
			lowUsageTagThreshold: settings.lowUsageTagThreshold,
			watchedTags: settings.watchedTags,
			ignoredFolders: settings.ignoredFolders,
		};

		const scannersRun: ScannerId[] = [];
		const issues: Issue[] = [];

		for (const scanner of this.scanners) {
			if (!ctx.enabledScanners.has(scanner.id)) continue;
			scannersRun.push(scanner.id);
			const result = scanner.scan(ctx);
			for (const issue of result) {
				if (!ctx.ignoredFingerprints.has(issue.fingerprint)) {
					issues.push(issue);
				}
			}
		}

		return {
			startedAt,
			finishedAt: Date.now(),
			issues,
			filesScanned: allFiles.length,
			scannersRun,
		};
	}
}
