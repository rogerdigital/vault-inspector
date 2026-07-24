import type { App, TFile, MetadataCache, Vault } from "obsidian";
import type { ScannerId } from "./Issue";

export type ScanContext = {
	app: App;
	metadataCache: MetadataCache;
	vault: Vault;
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	clearTimeout?: (timeoutId: unknown) => void;
	markdownFiles: TFile[];
	allFiles: TFile[];
	filePathIndex: Set<string>;
	enabledScanners: Set<ScannerId>;
	ignoredFingerprints: Set<string>;
	largeMarkdownBytes: number;
	largeAttachmentBytes: number;
	ignoredLargeMarkdownFrontmatterKeys: string[];
	ignoredLargeMarkdownPathPatterns: string[];
	duplicateHashMaxBytes: number;
	lowUsageTagThreshold: number;
	watchedTags: string[];
	ignoredFolders: string[];
	ignoredProperties: string[];
	emptyNoteWordThreshold: number;
};
