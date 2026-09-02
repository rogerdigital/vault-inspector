import type { CachedMetadata, TFile } from "obsidian";
import type { ScanContext } from "../../scanner/ScanContext";
import type { ScannerId } from "../../scanner/Issue";
import { makeEmptyReferenceIndex } from "../../scanner/reference-index";

type TestFileInput = {
	path: string;
	size?: number;
	mtime?: number;
};

type TestMetadataByPath = Record<string, CachedMetadata | null>;

type TestContextOptions = {
	scanner?: ScannerId;
	files?: TestFileInput[];
	markdownPaths?: string[];
	metadataByPath?: TestMetadataByPath;
	resolvedLinks?: Record<string, Record<string, string>>;
	unresolvedLinks?: Record<string, Record<string, number>>;
	overrides?: Partial<ScanContext>;
};

export function makeTestFile(input: string | TestFileInput): TFile {
	const file = typeof input === "string" ? { path: input } : input;
	const name = file.path.split("/").pop() ?? file.path;
	const extension = name.includes(".") ? name.split(".").pop()! : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	return {
		path: file.path,
		name,
		basename,
		extension,
		stat: {
			ctime: file.mtime ?? 1000,
			mtime: file.mtime ?? 1000,
			size: file.size ?? 100,
		},
	} as TFile;
}

export function makeScanContext(options: TestContextOptions = {}): ScanContext {
	const files = (options.files ?? []).map(makeTestFile);
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const markdownPaths = options.markdownPaths ?? files
		.filter((file) => file.path.endsWith(".md"))
		.map((file) => file.path);
	const markdownFiles = markdownPaths.map((path) =>
		filesByPath.get(path) ?? makeTestFile(path),
	);
	const allFiles = [
		...files,
		...markdownFiles.filter((file) => !filesByPath.has(file.path)),
	];
	const metadataByPath = options.metadataByPath ?? {};

	return {
		app: {} as any,
		metadataCache: {
			getFileCache: (file: TFile) => metadataByPath[file.path] ?? {},
			resolvedLinks: options.resolvedLinks ?? {},
			unresolvedLinks: options.unresolvedLinks ?? {},
		} as any,
		vault: {} as any,
		markdownFiles,
		allFiles,
		filePathIndex: new Set(allFiles.map((file) => file.path)),
		enabledScanners: new Set(options.scanner ? [options.scanner] : []),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		ignoredLargeMarkdownFrontmatterKeys: ["excalidraw-plugin"],
		ignoredLargeMarkdownPathPatterns: [],
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		emptyNoteWordThreshold: 5,
		referenceIndex: makeEmptyReferenceIndex(),
		watchedTags: [],
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
		ignoredProperties: [],
		requestUrl: undefined,
		setTimeout: undefined,
		clearTimeout: undefined,
		...options.overrides,
	} as ScanContext;
}
