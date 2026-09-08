import { App, TFile } from "obsidian";
import type { FixAction } from "../scanner/Issue";
import { markdownLinks, wikiLinkRanges } from "../utils/markdown-source";

export async function executeFixAction(app: App, action: FixAction): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths);
		case "remove-link-text": {
			const source = action.targetPaths[0];
			if (action.original !== undefined) {
				return replaceLinkText(app, source, action.original, action.replacement ?? "");
			}
			return removeLinkText(app, source, action.linkText!);
		}
		default:
			return 0;
	}
}

async function trashFiles(app: App, paths: string[]): Promise<number> {
	let count = 0;
	for (const path of paths) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file) {
			await app.fileManager.trashFile(file);
			count++;
		}
	}
	return count;
}

async function removeLinkText(app: App, sourcePath: string, linkText: string): Promise<number> {
	return replaceLinkText(app, sourcePath, undefined, "", linkText);
}

/** Parse once per action, then splice only complete, matching source ranges. */
async function replaceLinkText(
	app: App,
	sourcePath: string,
	original: string | undefined,
	replacement: string,
	legacyLinkText?: string,
): Promise<number> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return 0;
	const content = await app.vault.read(file);
	const wiki = original === undefined || /^!?\[\[/.test(original);
	const ranges = (wiki ? wikiLinkRanges(content) : markdownLinks(content)).filter(({ start, end }) => {
		const source = content.slice(start, end);
		return original !== undefined
			? source === original
			: source === `[[${legacyLinkText}]]` || source === `![[${legacyLinkText}]]`;
	}).sort((left, right) => left.start - right.start);
	let cursor = 0;
	let updated = "";
	for (const { start, end } of ranges) {
		if (start < cursor) continue;
		updated += content.slice(cursor, start) + replacement;
		cursor = end;
	}
	updated += content.slice(cursor);
	if (updated === content) return 0;
	await app.vault.modify(file, updated);
	return 1;
}
