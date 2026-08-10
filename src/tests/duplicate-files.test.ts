import { describe, it, expect } from "vitest";
import { duplicateFilesScanner } from "../scanner/scanners/duplicate-files";
import type { ScanContext } from "../scanner/ScanContext";

function makeFile(path: string, size: number) {
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
	it("reports hash-identical files as warning", async () => {
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
		const hashIssues = issues.filter((i) => i.severity === "warning");
		expect(hashIssues).toHaveLength(1);
		expect(hashIssues[0].evidence.count).toBe(2);
		expect(hashIssues[0]).toMatchObject({
			classification: "confirmed",
			explanation: {
				why: "SHA-256 content hashes match across 2 files.",
				caveat:
					"The files are byte-identical, but their locations can still serve different workflows.",
				nextStep:
					"Choose the file to keep before moving the remaining copies to trash.",
			},
		});
		expect(hashIssues[0].fixAction).toEqual({
			kind: "trash-file",
			label: "Delete duplicates",
			description: 'Keep "notes/a.md" and move 1 duplicate(s) to trash',
			targetPaths: ["notes/b.md"],
			selection: {
				kind: "keep-one",
				candidatePaths: ["notes/a.md", "notes/b.md"],
				automaticKeepPath: "notes/a.md",
			},
		});
	});

	it("sorts complete paths before choosing the automatic keep file", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [
				makeFile("z-last/copy.md", 3),
				makeFile("a-first/copy.md", 3),
				makeFile("m-middle/copy.md", 3),
			],
			filePathIndex: new Set([
				"z-last/copy.md",
				"a-first/copy.md",
				"m-middle/copy.md",
			]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});

		const [issue] = await duplicateFilesScanner.scan(ctx);

		expect(issue.fixAction?.selection).toEqual({
			kind: "keep-one",
			candidatePaths: [
				"a-first/copy.md",
				"m-middle/copy.md",
				"z-last/copy.md",
			],
			automaticKeepPath: "a-first/copy.md",
		});
		expect(issue.fixAction?.targetPaths).toEqual([
			"m-middle/copy.md",
			"z-last/copy.md",
		]);
	});

	it("reports same-name candidates as info when content differs", async () => {
		const fileA = makeFile("notes/readme.md", 10);
		const fileB = makeFile("archive/readme.md", 20);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/readme.md", "archive/readme.md"]),
			vault: {
				readBinary: async (file: any) => {
					const encoder = new TextEncoder();
					return encoder.encode(`unique-${file.path}`).buffer;
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		const nameIssues = issues.filter(
			(i) => i.title.includes("same name"),
		);
		expect(nameIssues).toHaveLength(1);
		expect(nameIssues[0].severity).toBe("info");
		expect(nameIssues[0]).toMatchObject({
			classification: "candidate",
			explanation: {
				why: expect.stringContaining("share the same filename"),
				caveat: "Matching names do not prove matching content.",
			},
		});
		expect(nameIssues[0].fixAction).toBeUndefined();
	});

	it("reports same-size candidates as info when content differs", async () => {
		const fileA = makeFile("notes/a.md", 100);
		const fileB = makeFile("notes/b.md", 100);
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
		const sizeIssues = issues.filter(
			(i) => i.title.includes("same size"),
		);
		expect(sizeIssues).toHaveLength(1);
		expect(sizeIssues[0].severity).toBe("info");
		expect(sizeIssues[0]).toMatchObject({
			classification: "candidate",
			explanation: {
				why: expect.stringContaining("share the same byte size"),
				caveat: "Matching sizes do not prove matching content.",
			},
		});
		expect(sizeIssues[0].fixAction).toBeUndefined();
	});

	it("does not report unique files", async () => {
		const fileA = makeFile("notes/a.md", 10);
		const fileB = makeFile("notes/b.md", 20);
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

	it("reports above-cap same-size files as info candidates", async () => {
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
		expect(issues[0].severity).toBe("info");
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
