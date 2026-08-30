import { fileURLToPath } from "node:url";
import type { App } from "obsidian";
import { createLocalApp } from "../../../cli/local-vault";
import { ScanRunner } from "../../scanner/ScanRunner";
import { registerDefaultScanners } from "../../scanner/register-scanners";
import { makeEmptyReferenceIndex } from "../../scanner/reference-index";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../../settings/settings";
import type { Issue, ScanResult } from "../../scanner/Issue";
import type { ScanContext } from "../../scanner/ScanContext";

/**
 * All fixture mtimes are pinned so time-dependent scanner behavior (the
 * 7-day orphan recency window) is deterministic in every test run.
 *
 * Assertions should locate findings by primaryPath/message, not array index —
 * scanner output order is not guaranteed across environments.
 */
export const FIXTURE_PAST_MTIME = Date.UTC(2020, 0, 1);

export type FixtureVaultOptions = {
	settings?: Partial<InspectorSettings>;
	mtimeOverrides?: Record<string, number>;
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
};

export type FixtureVaultScan = {
	root: string;
	settings: InspectorSettings;
	result: ScanResult;
	issues: Issue[];
};

export function fixtureVaultRoot(): string {
	return fileURLToPath(new URL("../fixtures/precision-vault", import.meta.url));
}

/**
 * Loads the fixture app and applies deterministic mtimes. Shared by
 * scanFixtureVault and loadFixtureVaultContext.
 */
async function loadPinnedFixtureApp(
	mtimeOverrides: Record<string, number>,
): Promise<App> {
	const app = await createLocalApp(fixtureVaultRoot());
	const matched = new Set<string>();
	for (const file of app.vault.getFiles()) {
		const stat = file.stat as { ctime: number; mtime: number };
		stat.ctime = FIXTURE_PAST_MTIME;
		const override = mtimeOverrides[file.path];
		if (override !== undefined) matched.add(file.path);
		stat.mtime = override ?? FIXTURE_PAST_MTIME;
	}
	const unknown = Object.keys(mtimeOverrides).filter((key) => !matched.has(key));
	if (unknown.length > 0) {
		throw new Error(
			`mtimeOverrides reference unknown fixture paths: ${unknown.join(", ")}`,
		);
	}
	return app;
}

/**
 * Builds a ScanContext over the fixture vault mirroring ScanRunner's field
 * mapping, for tests that exercise context-consuming modules directly
 * (e.g. buildReferenceIndex). The referenceIndex starts empty; callers
 * replace it as needed.
 */
export async function loadFixtureVaultContext(
	options: FixtureVaultOptions = {},
): Promise<{ app: App; ctx: ScanContext }> {
	const app = await loadPinnedFixtureApp(options.mtimeOverrides ?? {});
	const allFiles = app.vault.getFiles();
	const ctx: ScanContext = {
		app,
		metadataCache: app.metadataCache,
		vault: app.vault,
		requestUrl: undefined,
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) =>
			clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
		markdownFiles: app.vault.getMarkdownFiles(),
		allFiles,
		filePathIndex: new Set(allFiles.map((file) => file.path)),
		enabledScanners: new Set(),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: DEFAULT_SETTINGS.largeMarkdownBytes,
		largeAttachmentBytes: DEFAULT_SETTINGS.largeAttachmentBytes,
		ignoredLargeMarkdownFrontmatterKeys:
			DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys,
		ignoredLargeMarkdownPathPatterns:
			DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns,
		duplicateHashMaxBytes: DEFAULT_SETTINGS.duplicateHashMaxBytes,
		lowUsageTagThreshold: DEFAULT_SETTINGS.lowUsageTagThreshold,
		watchedTags: DEFAULT_SETTINGS.watchedTags,
		ignoredFolders: options.settings?.ignoredFolders ?? [],
		ignoreUnresolvedNoteLinks:
			options.settings?.ignoreUnresolvedNoteLinks ??
			DEFAULT_SETTINGS.ignoreUnresolvedNoteLinks,
		ignoredProperties: options.settings?.ignoredProperties ?? [],
		emptyNoteWordThreshold: DEFAULT_SETTINGS.emptyNoteWordThreshold,
		referenceIndex: makeEmptyReferenceIndex(),
	};
	return { app, ctx };
}

export async function scanFixtureVault(
	options: FixtureVaultOptions = {},
): Promise<FixtureVaultScan> {
	const app = await loadPinnedFixtureApp(options.mtimeOverrides ?? {});
	const settings: InspectorSettings = {
		...structuredClone(DEFAULT_SETTINGS),
		...options.settings,
	};
	const scanRunner = new ScanRunner(options.requestUrl, {
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) =>
			clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
	});
	registerDefaultScanners(scanRunner);
	const result = await scanRunner.run(app, settings);
	return { root: fixtureVaultRoot(), settings, result, issues: result.issues };
}
