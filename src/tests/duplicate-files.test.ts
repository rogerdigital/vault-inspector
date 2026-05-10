import { describe, it, expect } from "vitest";
import { duplicateFilesScanner } from "../scanner/scanners/duplicate-files";
import type { ScanContext } from "../scanner/ScanContext";

function makeFile(path: string, size: number, content?: Uint8Array) {
	return {
		path,
		stat: { size, mtime: 1000 },
	} as any;
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {
			readBinary: async (file: any) => {
				// Return deterministic content based on file path for testing
				const encoder = new TextEncoder();
				return encoder.encode(file.path).buffer;
			},
		} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["duplicate-files"]),
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

describe("duplicateFilesScanner", () => {
	it("detects files with identical content", async () => {
		const sharedContent = new Uint8Array([1, 2, 3, 4]);
		const fileA = makeFile("notes/a.md", 4);
		const fileB = makeFile("notes/b.md", 4);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.count).toBe(2);
	});

	it("does not report unique files", async () => {
		const fileA = makeFile("notes/a.md", 4);
		const fileB = makeFile("notes/b.md", 4);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async (file: any) => {
					const encoder = new TextEncoder();
					return encoder.encode(`unique-${file.path}`).buffer;
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips empty files", async () => {
		const fileA = makeFile("notes/a.md", 0);
		const fileB = makeFile("notes/b.md", 0);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => new ArrayBuffer(0),
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("handles files exceeding hash cap by using size fingerprint", async () => {
		const fileA = makeFile("notes/big1.bin", 2 * 1024 * 1024);
		const fileB = makeFile("notes/big2.bin", 2 * 1024 * 1024);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/big1.bin", "notes/big2.bin"]),
			duplicateHashMaxBytes: 1024 * 1024,
			vault: {
				readBinary: async () => new ArrayBuffer(0),
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
	});

	it("skips files in ignored folders", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const fileA = makeFile("templates/a.md", 3);
		const fileB = makeFile("templates/b.md", 3);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["templates/a.md", "templates/b.md"]),
			ignoredFolders: ["templates"],
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("produces stable fingerprints", async () => {
		const sharedContent = new Uint8Array([5, 6, 7]);
		const fileA = makeFile("notes/a.md", 3);
		const fileB = makeFile("notes/b.md", 3);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const issues1 = await duplicateFilesScanner.scan(ctx);
		const issues2 = await duplicateFilesScanner.scan(ctx);
		expect(issues1[0].fingerprint).toBe(issues2[0].fingerprint);
	});
});
