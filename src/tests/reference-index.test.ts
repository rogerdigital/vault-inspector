import { describe, expect, it } from "vitest";
import type { ScanContext } from "../scanner/ScanContext";
import {
	buildReferenceIndex,
	getInboundReference,
	isReferenced,
	makeEmptyReferenceIndex,
} from "../scanner/reference-index";
import { makeScanContext, makeTestFile } from "./helpers/scan-context";
import { loadFixtureVaultContext } from "./helpers/fixture-vault";

function mdLink(link: string) {
	return { link, original: "", position: {} as any };
}

function canvasContext(canvasFiles: Record<string, string>): ScanContext {
	const canvasEntries = Object.entries(canvasFiles).map(([path, content]) =>
		makeTestFile(path),
	);
	const markdown = makeTestFile("notes/source.md");
	const ctx = makeScanContext({
		scanner: "orphan-attachments",
		files: [markdown, ...canvasEntries],
		metadataByPath: {
			"notes/source.md": { links: [], embeds: [], frontmatterLinks: [] },
		},
		overrides: {
			vault: {
				cachedRead: async (file: { path: string }) => {
					const content = canvasFiles[file.path];
					if (content === undefined) throw new Error("not found");
					return content;
				},
			} as any,
		},
	});
	return ctx;
}

describe("buildReferenceIndex markdown sources", () => {
	it("records inbound count, kinds, and sources for links, embeds, and frontmatter links", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("notes/a.md"),
				makeTestFile("notes/b.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"notes/a.md": {
					links: [mdLink("assets/used.png")],
					embeds: [mdLink("assets/used.png")],
					frontmatterLinks: [{ key: "cover", ...mdLink("assets/used.png") }],
				},
				"notes/b.md": {
					links: [mdLink("assets/used.png")],
					embeds: [],
					frontmatterLinks: [],
				},
			},
		});
		const index = await buildReferenceIndex(ctx);
		const inbound = getInboundReference(index, "assets/used.png");
		expect(inbound).toBeDefined();
		expect(inbound?.count).toBe(4);
		expect(inbound?.kinds).toEqual(["embed", "frontmatter", "note-link"]);
		expect(inbound?.sources).toEqual(["notes/a.md", "notes/b.md"]);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
		expect(isReferenced(index, "notes/a.md")).toBe(false);
	});

	it("skips external URLs and unresolved targets", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("notes/a.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"notes/a.md": {
					links: [
						mdLink("https://example.com/x"),
						mdLink("missing.png"),
						mdLink("assets/used.png"),
					],
					embeds: [],
					frontmatterLinks: [],
				},
			},
		});
		const index = await buildReferenceIndex(ctx);
		expect(index.inboundByPath.size).toBe(1);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
	});

	it("counts references from notes inside ignored folders", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("templates/source.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"templates/source.md": {
					links: [mdLink("assets/used.png")],
					embeds: [],
					frontmatterLinks: [],
				},
			},
			overrides: { ignoredFolders: ["templates"] },
		});
		const index = await buildReferenceIndex(ctx);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
	});

	it("marks coverage incomplete when a Markdown metadata cache entry is missing", async () => {
		const source = makeTestFile("notes/uncached.md");
		const attachment = makeTestFile("assets/maybe-used.png");
		const ctx = makeScanContext({
			files: [source, attachment],
			metadataByPath: {},
			overrides: {
				metadataCache: {
					getFileCache: () => null,
				} as any,
			},
		});

		const index = await buildReferenceIndex(ctx);

		expect(index.coverageComplete).toBe(false);
		expect(index.coverageFailures).toEqual([
			{ path: "notes/uncached.md", reason: "metadata-cache-missing" },
		]);
	});

	it("performs no vault reads when no canvas files exist", async () => {
		let reads = 0;
		const ctx = makeScanContext({
			files: [makeTestFile("notes/a.md"), makeTestFile("assets/used.png")],
			metadataByPath: {
				"notes/a.md": {
					links: [mdLink("assets/used.png")],
					embeds: [],
					frontmatterLinks: [],
				},
			},
			overrides: {
				vault: {
					cachedRead: async () => {
						reads++;
						return "";
					},
				} as any,
			},
		});
		await buildReferenceIndex(ctx);
		expect(reads).toBe(0); // no canvas files -> no reads at all
	});
});

describe("buildReferenceIndex canvas sources", () => {
	it("records canvas file-node references with the canvas kind", async () => {
		const ctx = canvasContext({
			"canvas/board.canvas": JSON.stringify({
				nodes: [
					{ id: "n1", type: "file", file: "assets/pic.png" },
					{ id: "n2", type: "text", text: "hello" },
					{ id: "n3", type: "file", file: "notes/a.md" },
				],
				edges: [],
			}),
			"notes/a.md": "# A",
		});
		const png = makeTestFile("assets/pic.png");
		ctx.allFiles = [...ctx.allFiles, png];
		ctx.filePathIndex = new Set([...ctx.filePathIndex, png.path]);
		const index = await buildReferenceIndex(ctx);
		expect(index.canvasFiles).toEqual(["canvas/board.canvas"]);
		expect(index.coverageComplete).toBe(true);
		expect(getInboundReference(index, "assets/pic.png")).toMatchObject({
			count: 1,
			kinds: ["canvas"],
			sources: ["canvas/board.canvas"],
		});
		expect(getInboundReference(index, "notes/a.md")).toMatchObject({
			kinds: ["canvas"],
		});
	});

	it("records Canvas group background references", async () => {
		const ctx = canvasContext({
			"canvas/board.canvas": JSON.stringify({
				nodes: [
					{
						id: "group-1",
						type: "group",
						background: "assets/background.png",
					},
				],
				edges: [],
			}),
		});
		const background = makeTestFile("assets/background.png");
		ctx.allFiles = [...ctx.allFiles, background];
		ctx.filePathIndex = new Set([...ctx.filePathIndex, background.path]);

		const index = await buildReferenceIndex(ctx);

		expect(getInboundReference(index, background.path)).toEqual({
			count: 1,
			kinds: ["canvas"],
			sources: ["canvas/board.canvas"],
		});
	});

	it("records malformed canvas JSON as a coverage failure without failing", async () => {
		const ctx = canvasContext({ "canvas/bad.canvas": "{not json" });
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(false);
		expect(index.coverageFailures).toEqual([
			{ path: "canvas/bad.canvas", reason: "malformed-json", detail: expect.any(String) },
		]);
	});

	it("records unreadable and non-object canvas files as coverage failures", async () => {
		// "canvas/odd.canvas" holds valid JSON that is not a canvas document,
		// which yields unexpected-shape (unquoted text would be malformed-json).
		const ctx = canvasContext({
			"canvas/gone.canvas": "{}",
			"canvas/odd.canvas": "\"just a string\"",
		});
		ctx.vault = {
			cachedRead: async (file: { path: string }) => {
				if (file.path === "canvas/gone.canvas") throw new Error("boom");
				return "\"just a string\"";
			},
		} as any;
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(false);
		const reasons = index.coverageFailures
			.map((failure) => `${failure.path}:${failure.reason}`)
			.sort();
		expect(reasons).toEqual([
			"canvas/gone.canvas:read-failed",
			"canvas/odd.canvas:unexpected-shape",
		]);
	});

	it("handles a batch of canvas files without coverage failures", async () => {
		const files: Record<string, string> = {};
		const extraFiles = [];
		for (let i = 1; i <= 50; i++) {
			files[`canvas/c${i}.canvas`] = JSON.stringify({
				nodes: [{ id: "n", type: "file", file: `assets/a${i}.png` }],
				edges: [],
			});
			extraFiles.push(makeTestFile(`assets/a${i}.png`));
		}
		const ctx = canvasContext(files);
		ctx.allFiles = [...ctx.allFiles, ...extraFiles];
		ctx.filePathIndex = new Set([...ctx.filePathIndex, ...extraFiles.map((f) => f.path)]);
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(true);
		expect(index.canvasFiles).toHaveLength(50);
		expect(index.inboundByPath.size).toBe(50);
	});
});

describe("buildReferenceIndex against the precision fixture vault", () => {
	it("sees every documented reference channel", async () => {
		const { ctx } = await loadFixtureVaultContext();
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(true);
		expect(index.canvasFiles).toEqual(["canvas/board.canvas"]);
		expect(getInboundReference(index, "attachments/canvas-image.png")).toEqual({
			count: 1,
			kinds: ["canvas"],
			sources: ["canvas/board.canvas"],
		});
		const frontmatter = getInboundReference(index, "attachments/frontmatter-doc.pdf");
		expect(frontmatter?.kinds).toContain("frontmatter");
		const photo = getInboundReference(index, "attachments/photo.jpg");
		expect(photo?.kinds).toEqual(["embed"]);
		expect(photo?.sources).toEqual([
			"notes/attachments-ref.md",
			"notes/empty/embed-only.md",
			"notes/hub/valid-links.md",
		]);
		const unicode = getInboundReference(index, "attachments/目标图片.png");
		expect(unicode?.kinds).toEqual(["embed"]);
		expect(isReferenced(index, "attachments/orphan.png")).toBe(false);
		expect(isReferenced(index, "attachments/recent-orphan.png")).toBe(false);
	});

	it("is deterministic across builds", async () => {
		const first = await loadFixtureVaultContext().then(({ ctx }) =>
			buildReferenceIndex(ctx),
		);
		const second = await loadFixtureVaultContext().then(({ ctx }) =>
			buildReferenceIndex(ctx),
		);
		expect([...second.inboundByPath.entries()]).toEqual(
			[...first.inboundByPath.entries()],
		);
		expect(second.coverageComplete).toBe(first.coverageComplete);
	});
});

describe("buildReferenceIndex high-degree targets", () => {
	it("aggregates 50,000 unique sources within a bounded time", async () => {
		const sourceCount = 50_000;
		const target = makeTestFile("assets/shared.png");
		const markdownFiles = Array.from({ length: sourceCount }, (_, index) =>
			makeTestFile(`notes/source-${String(index).padStart(5, "0")}.md`),
		);
		const metadataByPath = Object.fromEntries(markdownFiles.map((file) => [
			file.path,
			{ links: [mdLink(target.path)], embeds: [], frontmatterLinks: [] },
		]));
		const ctx = makeScanContext({
			files: [...markdownFiles, target],
			metadataByPath,
		});

		const startedAt = performance.now();
		const index = await buildReferenceIndex(ctx);
		const elapsedMs = performance.now() - startedAt;
		const inbound = getInboundReference(index, target.path);

		expect(elapsedMs).toBeLessThan(5_000);
		expect(inbound?.count).toBe(sourceCount);
		expect(inbound?.kinds).toEqual(["note-link"]);
		expect(inbound?.sources).toHaveLength(sourceCount);
		expect(inbound?.sources[0]).toBe("notes/source-00000.md");
		expect(inbound?.sources.at(-1)).toBe("notes/source-49999.md");
	}, 30_000);
});

describe("makeEmptyReferenceIndex", () => {
	it("provides a blank, complete index", () => {
		const index = makeEmptyReferenceIndex();
		expect(index.inboundByPath.size).toBe(0);
		expect(index.coverageComplete).toBe(true);
		expect(isReferenced(index, "anything.png")).toBe(false);
	});
});
