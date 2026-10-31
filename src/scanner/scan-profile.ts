import { getExclusionRules } from "./exclusions";
import { SCANNER_IDS } from "./Issue";
import type { InspectorSettings } from "../settings/settings";
import { hashContent } from "../utils/hash";
import { normalizeTagName } from "../utils/tags";

type PresentationOnlySettingKey =
	| "enableFixActions"
	| "duplicateKeepMode"
	| "ignoredIssueFingerprints"
	| "reportFolderPath"
	| "automaticScanIntervalHours"
	| "automaticScanNetworkChecks";
// Legacy folder settings are represented by their effective exclusion rules.
type DetectionSettingKey = Exclude<keyof InspectorSettings, PresentationOnlySettingKey | "ignoredFolders" | "ignoredFoldersByScanner">;

export async function createScanProfile(settings: InspectorSettings): Promise<string> {
	const canonical = {
		enabledScanners: SCANNER_IDS.filter((scannerId) => settings.enabledScanners[scannerId]),
		exclusionRules: getExclusionRules(settings),
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
