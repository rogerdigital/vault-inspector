import { describe, it, expect } from "vitest";
import { duplicateFilesScanner } from "../scanner/scanners/duplicate-files";
import type { ScanContext } from "../scanner/ScanContext";
import type { ReferenceIndex } from "../scanner/reference-index";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeFile(path: string, size: number, mtime = 1000) {
	return {
		path,
		stat: { size, mtime },
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
		referenceIndex: makeEmptyReferenceIndex(),
		...overrides,
	} as ScanContext;
}

function makeIndex(referenceCounts: Record<string, number>): ReferenceIndex {
	return {
		inboundByPath: new Map(
			Object.entries(referenceCounts).map(([path, count]) => [
				path,
				{ count, kinds: ["note-link"], sources: ["notes/a.md"] },
			]),
		),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: true,
	};
}

describe("duplicateFilesScanner", () => {
	it("reports hash-identical files as warning with hash-state, reference, and mtime evidence", async () => {
		const sharedContent = new Uint8Array([1, 2, 3, 4]);
		const fileA = makeFile("notes/a.md", 4, 2000);
		const fileB = makeFile("notes/b.md", 4, 3000);
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
		expect(hashIssues[0]).toMatchObject({
			classification: "confirmed",
			evidence: {
				count: 2,
				hashState: "hash-confirmed",
				referenceCounts: "0,0",
				mtimes: "2000,3000",
				referencedPaths: "",
			},
			explanation: {
				why: "SHA-256 content hashes match across 2 files.",
				caveat:
					"The files are byte-identical, but their locations can still serve different workflows.",
				nextStep:
					"Choose the file to keep before moving the remaining copies to trash.",
			},
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "notes/a.md" and move 1 duplicate(s) to trash',
				targetPaths: ["notes/b.md"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["notes/a.md", "notes/b.md"],
					automaticKeepPath: "notes/a.md",
					referencedPaths: [],
					requiresReview: false,
				},
			},
		});
	});

	it("keeps the path with the highest inbound reference count in automatic mode", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [
				makeFile("notes/a.md", 3),
				makeFile("notes/b.md", 3),
				makeFile("notes/c.md", 3),
			],
			filePathIndex: new Set(["notes/a.md", "notes/b.md", "notes/c.md"]),
			referenceIndex: makeIndex({
				"notes/a.md": 0,
				"notes/b.md": 3,
				"notes/c.md": 1,
			}),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection?.automaticKeepPath).toBe("notes/b.md");
		expect(issue.fixAction?.targetPaths).toEqual(["notes/a.md", "notes/c.md"]);
		expect(issue.evidence.referenceCounts).toBe("0,3,1");
		expect(issue.evidence.referencedPaths).toBe("notes/b.md,notes/c.md");
	});

	it("breaks equal reference counts by stable vault-relative path order", async () => {
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
			referenceIndex: makeIndex({
				"z-last/copy.md": 2,
				"a-first/copy.md": 2,
				"m-middle/copy.md": 0,
			}),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection).toMatchObject({
			candidatePaths: [
				"a-first/copy.md",
				"m-middle/copy.md",
				"z-last/copy.md",
			],
			automaticKeepPath: "a-first/copy.md",
			referencedPaths: ["a-first/copy.md", "z-last/copy.md"],
			requiresReview: true,
		});
		expect(issue.fixAction?.targetPaths).toEqual([
			"m-middle/copy.md",
			"z-last/copy.md",
		]);
		expect(issue.explanation.nextStep).toBe(
			"Several copies are referenced from notes. Review which location to keep before moving any copy to trash.",
		);
	});

	it("does not require review when only one copy is referenced", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [makeFile("notes/a.md", 3), makeFile("notes/b.md", 3)],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			referenceIndex: makeIndex({ "notes/b.md": 1 }),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection).toMatchObject({
			automaticKeepPath: "notes/b.md",
			referencedPaths: ["notes/b.md"],
			requiresReview: false,
		});
	});

	it("reports same-name candidates with per-file hash states when content differs", async () => {
		const fileA = makeFile("notes/readme.md", 10, 5000);
		const fileB = makeFile("archive/readme.md", 20, 6000);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/readme.md", "archive/readme.md"]),
			referenceIndex: makeIndex({ "notes/readme.md": 2 }),
			vault: {
				readBinary: async (file: any) => {
					const encoder = new TextEncoder();
					return encoder.encode(`unique-${file.path}`).buffer;
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		const nameIssues = issues.filter((i) => i.title.includes("same name"));
		expect(nameIssues).toHaveLength(1);
		expect(nameIssues[0].severity).toBe("info");
		expect(nameIssues[0].classification).toBe("candidate");
		expect(nameIssues[0].evidence).toMatchObject({
			hashStates: "hash-confirmed",
			referenceCounts: "0,2",
			mtimes: "6000,5000",
		});
		// Aligned by index with relatedPaths (sorted).
		expect(nameIssues[0].relatedPaths).toEqual([
			"archive/readme.md",
			"notes/readme.md",
		]);
		expect(nameIssues[0].fixAction).toBeUndefined();
	});

	it("degrades read failures to candidates with read-failed hash states", async () => {
		const fileA = makeFile("notes/a.md", 10);
		const fileB = makeFile("notes/b.md", 10);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => {
					throw new Error("simulated read failure");
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues.some((i) => i.severity === "warning")).toBe(false);
		const candidates = issues.filter((i) => i.classification === "candidate");
		// Same size, different names: exactly one same-size candidate group.
		expect(candidates).toHaveLength(1);
		expect(
			candidates.every((i) => i.evidence.hashStates === "read-failed"),
		).toBe(true);
		expect(candidates.every((i) => i.fixAction === undefined)).toBe(true);
	});

	it("reports above-cap same-size files as cap-exceeded candidates", async () => {
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
		expect(issues[0].evidence.hashStates).toBe("cap-exceeded");
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
		const base = {
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		};
		const issues1 = await duplicateFilesScanner.scan(makeCtx(base));
		const issues2 = await duplicateFilesScanner.scan(makeCtx(base));
		expect(issues1[0].fingerprint).toBe(issues2[0].fingerprint);
	});

	it("keeps fingerprints stable when reference counts change", async () => {
		const sharedContent = new Uint8Array([5, 6, 7]);
		const base = {
			allFiles: [makeFile("notes/a.md", 3), makeFile("notes/b.md", 3)],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		};
		const unreferenced = await duplicateFilesScanner.scan(makeCtx(base));
		const referenced = await duplicateFilesScanner.scan(
			makeCtx({ ...base, referenceIndex: makeIndex({ "notes/b.md": 4 }) }),
		);
		expect(referenced[0].fingerprint).toBe(unreferenced[0].fingerprint);
	});
});
