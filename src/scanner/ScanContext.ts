import type { App, TFile, MetadataCache, Vault } from "obsidian";
import type { ScannerId } from "./Issue";

export type ScanContext = {
	app: App;
	metadataCache: MetadataCache;
	vault: Vault;
	requestUrl?: (url: string) => Promise<number>;
	markdownFiles: TFile[];
	allFiles: TFile[];
	filePathIndex: Set<string>;
	enabledScanners: Set<ScannerId>;
	ignoredFingerprints: Set<string>;
	largeMarkdownBytes: number;
	largeAttachmentBytes: number;
	duplicateHashMaxBytes: number;
	lowUsageTagThreshold: number;
	watchedTags: string[];
	ignoredFolders: string[];
	ignoredProperties: string[];
	emptyNoteWordThreshold: number;
};
