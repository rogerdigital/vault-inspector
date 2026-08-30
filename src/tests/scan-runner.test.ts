import { describe, expect, it, vi } from "vitest";
import { ScanRunner } from "../scanner/ScanRunner";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { ScanContext } from "../scanner/ScanContext";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeApp() {
	return {
		metadataCache: {},
		vault: {
			getMarkdownFiles: vi.fn(() => []),
			getFiles: vi.fn(() => []),
		},
	} as any;
}

describe("ScanRunner scanner-specific ignored folders", () => {
	it("combines global and scanner-specific folders without leaking between scanners", async () => {
		const seen = new Map<string, string[]>();
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				seen.set("broken-links", ctx.ignoredFolders);
				return [];
			},
		});
		runner.register({
			id: "duplicate-files",
			scan: (ctx: ScanContext) => {
				seen.set("duplicate-files", ctx.ignoredFolders);
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.enabledScanners = {
			...settings.enabledScanners,
			"broken-links": true,
			"duplicate-files": true,
		};
		settings.ignoredFolders = ["archive", "shared"];
		settings.ignoredFoldersByScanner["broken-links"] = [
			"syncTrash",
			"shared",
		];
		settings.ignoredFoldersByScanner["duplicate-files"] = [];

		await runner.run(makeApp(), settings);

		expect(seen.get("broken-links")).toEqual([
			"archive",
			"shared",
			"syncTrash",
		]);
		expect(seen.get("duplicate-files")).toEqual(["archive", "shared"]);
		expect(settings.ignoredFolders).toEqual(["archive", "shared"]);
	});

	it("passes the unresolved-note policy into scanner contexts", async () => {
		let observed: boolean | undefined;
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				observed = ctx.ignoreUnresolvedNoteLinks;
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoreUnresolvedNoteLinks = true;

		await runner.run(makeApp(), settings);

		expect(observed).toBe(true);
	});
});

describe("ScanRunner shared reference index", () => {
	it("builds the index once and passes it to scanner contexts", async () => {
		const observed: unknown[] = [];
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				observed.push(ctx.referenceIndex);
				return [];
			},
		});
		runner.register({
			id: "orphan-attachments",
			scan: (ctx: ScanContext) => {
				observed.push(ctx.referenceIndex);
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.enabledScanners = {
			...settings.enabledScanners,
			"broken-links": true,
			"orphan-attachments": true,
		};

		await runner.run(makeApp(), settings);

		expect(observed).toHaveLength(2);
		expect(observed[0]).toBe(observed[1]); // same instance, built once
		expect((observed[0] as ReturnType<typeof makeEmptyReferenceIndex>).inboundByPath).toBeInstanceOf(Map);
	});
});
