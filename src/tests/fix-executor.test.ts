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
	let disk = content;
	const process = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
		disk = transform(disk);
		return disk;
	});
	const read = vi.fn(async () => disk);
	const modify = vi.fn(async (_file: TFile, text: string) => { disk = text; });
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read,
			modify,
			process,
		},
	};
	return { app, file, process, modify, getContent: () => disk };
}

describe("executeFixAction", () => {
	it("replaces the aliased wiki link with its alias and preserves other headings", async () => {
		const action = await makeAliasedHeadingFixAction();
		const content = [
			"[[Target#Missing heading|missing]]",
			"[[Target#Other heading|other]]",
			"[[Target|plain]]",
			"![[Target#Missing heading|missing]]",
		].join("\n");
		const { app, file, getContent } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(action.linkText).toBe("Target#Missing heading|missing");
		expect(action.original).toBe("[[Target#Missing heading|missing]]");
		expect(action.replacement).toBe("missing");
		expect(getContent()).toBe(
			[
				"missing",
				"[[Target#Other heading|other]]",
				"[[Target|plain]]",
				// A complete embed range cannot match a non-embed original.
				"![[Target#Missing heading|missing]]",
			].join("\n"),
		);
	});

	it("replaces markdown links with their label text", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "[Readable Markdown](missing-target.md)",
			replacement: "Readable Markdown",
		};
		const content = [
			"Prefix [Readable Markdown](missing-target.md) suffix.",
			"![Readable Markdown](missing-target.md)",
		].join("\n");
		const { app, file, getContent } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(getContent()).toBe(
			[
				"Prefix Readable Markdown suffix.",
				"![Readable Markdown](missing-target.md)",
			].join("\n"),
		);
	});

	it("removes embeds entirely, including the leading bang", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "![[missing-embed.png]]",
			replacement: "",
		};
		const content = "Before ![[missing-embed.png]] after";
		const { app, file, getContent } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(getContent()).toBe("Before  after");
	});

	it("still supports the legacy linkText wiki path", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			linkText: "Legacy|Alias",
		};
		const content = "Keep [[Legacy|Alias]] here";
		const { app, file, getContent } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(getContent()).toBe("Keep  here");
	});

	it("returns 0 when the original syntax is no longer present", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "[[Gone]]",
			replacement: "Gone",
		};
		const { app, getContent } = makeApp("Nothing to see");

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(0);
		expect(getContent()).toBe("Nothing to see");
	});

	it("preserves an edit committed before the atomic transformation", async () => {
		const file = Object.assign(new TFile(), { path: "Source.md" });
		let disk = "[label](missing)\nOriginal paragraph";
		const appended = "\nConcurrent user edit";
		const read = vi.fn(async () => {
			const stale = disk;
			disk += appended;
			return stale;
		});
		const modify = vi.fn(async (_file: TFile, text: string) => { disk = text; });
		const process = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
			disk += appended;
			disk = transform(disk);
			return disk;
		});
		const app = { vault: { getAbstractFileByPath: () => file, read, modify, process } };
		const count = await executeFixAction(app as any, {
			kind: "remove-link-text", label: "Remove link", description: "",
			targetPaths: [file.path], original: "[label](missing)", replacement: "label",
		});
		expect(count).toBe(1);
		expect(disk).toBe("label\nOriginal paragraph\nConcurrent user edit");
		expect(process).toHaveBeenCalledTimes(1);
		expect(read).not.toHaveBeenCalled();
		expect(modify).not.toHaveBeenCalled();
	});

	it("does not replace inside code or HTML comments", async () => {
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
		const { app, file, getContent } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(getContent()).toBe(
			[
				"Before missing after",
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


describe("parsed source safety", () => {
	it.each(["[Missing](missing.md)", "[[Missing]]", "[[Missing|Alias]]", "![[Missing]]", "![Missing](missing.md)"])("only replaces valid occurrences of %s", async (original) => {
		const protectedText = [
			`    ${original}`, `\t${original}`,
			`- item\n\n      ${original}`, `>     ${original}`,
			`\\${original}`, `\\\\\\${original}`,
			`\`${original}\``, `~~~md\n${original}\n~~~`, `<!-- ${original} -->`,
		].join("\n\n");
		const prefix = `\uFEFF---\r\nref: '${original}'\r\n---\r\n`;
		const content = prefix + original + "\n\n" + protectedText + "\n\n" + original;
		const { app, file, getContent } = makeApp(content);
		expect(await executeFixAction(app as any, {
			kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"], original, replacement: "Shown",
		})).toBe(1);
		expect(getContent()).toBe(prefix + "Shown\n\n" + protectedText + "\n\nShown");
	});

	it("restricts legacy wiki removal to parsed ranges", async () => {
		const content = "[[Missing]]\n\n    [[Missing]]\n\n\\[[Missing]]";
		const { app, file, getContent } = makeApp(content);
		expect(await executeFixAction(app as any, {
			kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"], linkText: "Missing",
		})).toBe(1);
		expect(getContent()).toBe("\n\n    [[Missing]]\n\n\\[[Missing]]");
	});
});


it.each(["[Missing](missing.md)", "[[Missing]]"])("replaces links after even backslashes: %s", async (original) => {
	const content = "\\\\" + original + "\r\n";
	const { app, file, getContent } = makeApp(content);
	expect(await executeFixAction(app as any, {
		kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"], original, replacement: "Shown",
	})).toBe(1);
	expect(getContent()).toBe("\\\\Shown\r\n");
});

it.each(["[[Missing|**bold**]]", "plain text", "    [[Missing]]"])("fails closed for unsupported or non-link source: %s", async (content) => {
	const { app, getContent } = makeApp(content);
	expect(await executeFixAction(app as any, {
		kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"], original: content.trim(), replacement: "Shown",
	})).toBe(0);
	expect(getContent()).toBe(content);
});

it("propagates a failed write instead of returning a false success", async () => {
	const { app, process } = makeApp("[[Missing]]");
	process.mockRejectedValueOnce(new Error("write failed"));
	await expect(executeFixAction(app as any, {
		kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"],
		original: "[[Missing]]", replacement: "Shown",
	})).rejects.toThrow("write failed");
});

it("returns 0 without restoring old text when the link vanished from latest content", async () => {
	const { app, getContent } = makeApp("[[Kept]] and [[Missing]]");
	const process = (app as any).vault.process;
	process.mockImplementationOnce(async (_file: unknown, transform: (text: string) => string) =>
		transform("[[Kept]]"));
	expect(await executeFixAction(app as any, {
		kind: "remove-link-text", label: "Remove", description: "", targetPaths: ["Source.md"],
		original: "[[Missing]]", replacement: "Shown",
	})).toBe(0);
	expect(getContent()).toBe("[[Kept]] and [[Missing]]");
});
