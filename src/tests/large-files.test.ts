import { describe, it, expect } from "vitest";
import { largeFilesScanner } from "../scanner/scanners/large-files";
import type { ScanContext } from "../scanner/ScanContext";

function makeFile(path: string, size: number) {
	return { path, stat: { size } } as any;
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["large-files"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		...overrides,
	} as ScanContext;
}

describe("largeFilesScanner", () => {
	it("detects large markdown files exceeding threshold", () => {
		const file = makeFile("notes/big.md", 200 * 1024);
		const ctx = makeCtx({
			allFiles: [file],
			filePathIndex: new Set(["notes/big.md"]),
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.type).toBe("markdown");
	});

	it("does not report files below threshold", () => {
		const file = makeFile("notes/small.md", 50 * 1024);
		const ctx = makeCtx({
			allFiles: [file],
			filePathIndex: new Set(["notes/small.md"]),
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("uses separate threshold for attachments", () => {
		const file = makeFile("assets/image.png", 6 * 1024 * 1024);
		const ctx = makeCtx({
			allFiles: [file],
			filePathIndex: new Set(["assets/image.png"]),
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.type).toBe("attachment");
	});

	it("does not report attachments below attachment threshold", () => {
		const file = makeFile("assets/image.png", 3 * 1024 * 1024);
		const ctx = makeCtx({
			allFiles: [file],
			filePathIndex: new Set(["assets/image.png"]),
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("sorts issues largest first", () => {
		const small = makeFile("notes/a.md", 150 * 1024);
		const big = makeFile("notes/b.md", 300 * 1024);
		const ctx = makeCtx({
			allFiles: [small, big],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(2);
		expect(issues[0].evidence.size).toBe(300 * 1024);
		expect(issues[1].evidence.size).toBe(150 * 1024);
	});

	it("skips files in ignored folders", () => {
		const file = makeFile("templates/big.md", 200 * 1024);
		const ctx = makeCtx({
			allFiles: [file],
			filePathIndex: new Set(["templates/big.md"]),
			ignoredFolders: ["templates"],
		});
		const issues = largeFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});
});
