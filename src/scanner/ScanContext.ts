import type { App, TFile, MetadataCache, Vault } from "obsidian";
import type { ScannerId } from "./Issue";
import type { ReferenceIndex } from "./reference-index";

export type ExternalHttpMethod = "HEAD" | "GET";

export type ExternalRequestResult = {
	status: number;
	method: ExternalHttpMethod;
};

/**
 * Method-aware external request contract. Implementations must:
 * 1. issue exactly the requested method against exactly the requested URL;
 * 2. throw on transport failure (the scanner maps that to a failed finding);
 * 3. return only the final status and method — never a response body;
 * 4. re-run URL/DNS/public-IP/redirect-target safety checks for every
 *    connection they open, including the Range GET fallback.
 */
export type ExternalRequestAdapter = (
	url: string,
	method: ExternalHttpMethod,
	signal?: AbortSignal,
) => Promise<ExternalRequestResult>;

export type ScanContext = {
	app: App;
	metadataCache: MetadataCache;
	vault: Vault;
	requestUrl?: ExternalRequestAdapter;
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
	ignoreUnresolvedNoteLinks: boolean;
	ignoredProperties: string[];
	emptyNoteWordThreshold: number;
	referenceIndex: ReferenceIndex;
};
