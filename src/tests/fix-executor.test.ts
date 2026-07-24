import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { executeFixAction } from "../fix/fix-executor";
import { brokenLinksScanner } from "../scanner/scanners/broken-links";
import type { FixAction } from "../scanner/Issue";
import { makeScanContext } from "./helpers/scan-context";

async function makeAliasedHeadingFixAction(): Promise<FixAction> {
	const ctx = makeScanContext({
		scanner: "broken-links",
		files: [
			{ path: "Source.md" },
			{ path: "Target.md" },
		],
		metadataByPath: {
			"Source.md": {
				links: [
					{
						link: "Target#Missing heading",
						original: "[[Target#Missing heading|missing]]",
						displayText: "missing",
						position: {} as any,
					},
					{
						link: "Target#Other heading",
						original: "[[Target#Other heading|other]]",
						displayText: "other",
						position: {} as any,
					},
				],
			},
			"Target.md": {
				headings: [
					{
						heading: "Other heading",
						level: 2,
						position: {} as any,
					},
				],
			},
		},
	});

	const issues = await brokenLinksScanner.scan(ctx);
	expect(issues).toHaveLength(1);
	expect(issues[0].fixAction).toBeDefined();
	return issues[0].fixAction!;
}

function makeApp(content: string) {
	const file = Object.assign(new TFile(), { path: "Source.md" });
	const modify = vi.fn(async () => {});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => content),
			modify,
		},
	};
	return { app, file, modify };
}

describe("executeFixAction", () => {
	it("uses the scanner's original aliased wiki link and preserves other headings", async () => {
		const action = await makeAliasedHeadingFixAction();
		const content = [
			"[[Target#Missing heading|missing]]",
			"[[Target#Other heading|other]]",
			"[[Target|plain]]",
			"![[Target#Missing heading|missing]]",
		].join("\n");
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(action.linkText).toBe("Target#Missing heading|missing");
		expect(modify).toHaveBeenCalledWith(
			file,
			[
				"",
				"[[Target#Other heading|other]]",
				"[[Target|plain]]",
				"",
			].join("\n"),
		);
	});

	it("does not remove matching wiki-link text from code or HTML comments", async () => {
		const action = await makeAliasedHeadingFixAction();
		const content = [
			"Before [[Target#Missing heading|missing]] after",
			"`[[Target#Missing heading|missing]]`",
			"``inline [[Target#Missing heading|missing]] with ` tick``",
			"```md",
			"[[Target#Missing heading|missing]]",
			"```",
			"<!-- [[Target#Missing heading|missing]] -->",
		].join("\n");
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(modify).toHaveBeenCalledWith(
			file,
			[
				"Before  after",
				"`[[Target#Missing heading|missing]]`",
				"``inline [[Target#Missing heading|missing]] with ` tick``",
				"```md",
				"[[Target#Missing heading|missing]]",
				"```",
				"<!-- [[Target#Missing heading|missing]] -->",
			].join("\n"),
		);
	});
});
