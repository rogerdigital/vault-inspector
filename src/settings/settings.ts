import type { ScannerId } from "../scanner/Issue";
import { SCANNER_IDS } from "../scanner/Issue";

export type DuplicateKeepMode = "always-ask" | "automatic";

export type InspectorSettings = {
	enabledScanners: Record<ScannerId, boolean>;
	enableFixActions: boolean;
	duplicateKeepMode: DuplicateKeepMode;
	largeMarkdownBytes: number;
	largeAttachmentBytes: number;
	ignoredLargeMarkdownFrontmatterKeys: string[];
	ignoredLargeMarkdownPathPatterns: string[];
	duplicateHashMaxBytes: number;
	lowUsageTagThreshold: number;
	emptyNoteWordThreshold: number;
	watchedTags: string[];
	ignoredIssueFingerprints: string[];
	ignoredFolders: string[];
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
	ignoredProperties: string[];
	reportFolderPath: string;
};

export function createEmptyIgnoredFoldersByScanner(): Record<ScannerId, string[]> {
	return Object.fromEntries(
		SCANNER_IDS.map((id) => [id, []]),
	) as Record<ScannerId, string[]>;
}

export const DEFAULT_SETTINGS: InspectorSettings = {
	enabledScanners: Object.fromEntries(
		SCANNER_IDS.map((id) => [id, id !== "external-links"]),
	) as Record<ScannerId, boolean>,
	enableFixActions: true,
	duplicateKeepMode: "always-ask",
	largeMarkdownBytes: 100 * 1024,
	largeAttachmentBytes: 5 * 1024 * 1024,
	ignoredLargeMarkdownFrontmatterKeys: ["excalidraw-plugin"],
	ignoredLargeMarkdownPathPatterns: [],
	duplicateHashMaxBytes: 1024 * 1024,
	lowUsageTagThreshold: 2,
	emptyNoteWordThreshold: 5,
	watchedTags: [],
	ignoredIssueFingerprints: [],
	ignoredFolders: [],
	ignoredFoldersByScanner: createEmptyIgnoredFoldersByScanner(),
	ignoredProperties: [],
	reportFolderPath: "Vault Inspector Reports",
};
