import { describe, it, expect } from "vitest";
import { inferType, typesAreCompatible } from "../utils/frontmatter-type";
import { frontmatterTypesScanner } from "../scanner/scanners/frontmatter-types";
import type { ScanContext } from "../scanner/ScanContext";

describe("inferType", () => {
	it("returns 'string' for plain strings", () => {
		expect(inferType("hello")).toBe("string");
	});

	it("returns 'number' for numbers", () => {
		expect(inferType(42)).toBe("number");
	});

	it("returns 'boolean' for booleans", () => {
		expect(inferType(true)).toBe("boolean");
	});

	it("returns 'date' for ISO date strings", () => {
		expect(inferType("2024-01-15")).toBe("date");
	});

	it("returns 'array' for arrays", () => {
		expect(inferType([1, 2, 3])).toBe("array");
	});

	it("returns 'null' for null and undefined", () => {
		expect(inferType(null)).toBe("null");
		expect(inferType(undefined)).toBe("null");
	});
});

describe("typesAreCompatible", () => {
	it("same types are compatible", () => {
		expect(typesAreCompatible("string", "string")).toBe(true);
	});

	it("null is compatible with everything", () => {
		expect(typesAreCompatible("null", "string")).toBe(true);
		expect(typesAreCompatible("number", "null")).toBe(true);
	});

	it("date and string are compatible", () => {
		expect(typesAreCompatible("date", "string")).toBe(true);
	});

	it("number and string are not compatible", () => {
		expect(typesAreCompatible("number", "string")).toBe(false);
	});

	it("boolean and number are not compatible", () => {
		expect(typesAreCompatible("boolean", "number")).toBe(false);
	});
});

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["frontmatter-types"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		ignoredProperties: [],
		...overrides,
	} as ScanContext;
}

describe("frontmatterTypesScanner", () => {
	it("detects type drift for a property", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const fileB = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA, fileB],
			allFiles: [fileA, fileB],
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/a.md") {
						return { frontmatter: { priority: 1 } };
					}
					if (f.path === "notes/b.md") {
						return { frontmatter: { priority: "high" } };
					}
					return null;
				},
			} as any,
		});
		const issues = await frontmatterTypesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].evidence.property).toBe("priority");
	});

	it("does not report when types are consistent", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const fileB = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA, fileB],
			allFiles: [fileA, fileB],
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/a.md") {
						return { frontmatter: { tags: ["a"] } };
					}
					if (f.path === "notes/b.md") {
						return { frontmatter: { tags: ["b", "c"] } };
					}
					return null;
				},
			} as any,
		});
		const issues = await frontmatterTypesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("ignores properties listed in ignoredProperties", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const fileB = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA, fileB],
			allFiles: [fileA, fileB],
			ignoredProperties: ["priority"],
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/a.md") {
						return { frontmatter: { priority: 1 } };
					}
					if (f.path === "notes/b.md") {
						return { frontmatter: { priority: "high" } };
					}
					return null;
				},
			} as any,
		});
		const issues = await frontmatterTypesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips the position property", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA],
			allFiles: [fileA],
			metadataCache: {
				getFileCache: () => ({
					frontmatter: { position: { start: 0 } },
				}),
			} as any,
		});
		const issues = await frontmatterTypesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("reports string/date ambiguity as info", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const fileB = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA, fileB],
			allFiles: [fileA, fileB],
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/a.md") {
						return { frontmatter: { date: "2024-01-15" } };
					}
					if (f.path === "notes/b.md") {
						return { frontmatter: { date: "yesterday" } };
					}
					return null;
				},
			} as any,
		});
		const issues = await frontmatterTypesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("info");
		expect(issues[0].title).toBe("Frontmatter type ambiguity");
	});
});
