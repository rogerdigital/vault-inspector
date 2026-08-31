import { SCANNER_IDS } from "./Issue";
import type { InspectorSettings } from "../settings/settings";
import { hashContent } from "../utils/hash";
import { normalizePath } from "../utils/paths";
import { normalizeTagName } from "../utils/tags";

type PresentationOnlySettingKey =
	| "enableFixActions"
	| "duplicateKeepMode"
	| "ignoredIssueFingerprints"
	| "reportFolderPath"
	| "automaticScanIntervalHours"
	| "automaticScanNetworkChecks";
type DetectionSettingKey = Exclude<keyof InspectorSettings, PresentationOnlySettingKey>;

export async function createScanProfile(settings: InspectorSettings): Promise<string> {
	const canonical = {
		enabledScanners: SCANNER_IDS.filter((scannerId) => settings.enabledScanners[scannerId]),
		ignoredFolders: normalizeFolders(settings.ignoredFolders),
		ignoredFoldersByScanner: Object.fromEntries(
			SCANNER_IDS.map((scannerId) => [
				scannerId,
				normalizeFolders(settings.ignoredFoldersByScanner[scannerId] ?? []),
			]),
		),
		ignoreUnresolvedNoteLinks: settings.ignoreUnresolvedNoteLinks,
		largeMarkdownBytes: settings.largeMarkdownBytes,
		largeAttachmentBytes: settings.largeAttachmentBytes,
		ignoredLargeMarkdownFrontmatterKeys: normalizeSet(
			settings.ignoredLargeMarkdownFrontmatterKeys,
		),
		ignoredLargeMarkdownPathPatterns: normalizeSet(
			settings.ignoredLargeMarkdownPathPatterns,
		),
		duplicateHashMaxBytes: settings.duplicateHashMaxBytes,
		lowUsageTagThreshold: settings.lowUsageTagThreshold,
		emptyNoteWordThreshold: settings.emptyNoteWordThreshold,
		watchedTags: normalizeWatchedTags(settings.watchedTags),
		ignoredProperties: normalizeSet(settings.ignoredProperties),
	} satisfies Record<DetectionSettingKey, unknown>;

	return hashContent(new TextEncoder().encode(JSON.stringify(canonical)).buffer);
}

function normalizeSet(values: string[]): string[] {
	return Array.from(new Set(values)).sort();
}

function normalizeWatchedTags(values: string[]): string[] {
	return normalizeSet(values.map(normalizeTagName).filter(Boolean));
}

function normalizeFolders(values: string[]): string[] {
	return normalizeSet(values.map(normalizePath).filter(Boolean));
}
