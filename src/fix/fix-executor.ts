import { App, TFile } from "obsidian";
import type { FixAction } from "../scanner/Issue";
import type { MutationFence } from "./metadata-write-fence";
import { markdownLinks, wikiLinkRanges } from "../utils/markdown-source";

export async function executeFixAction(
	app: App,
	action: FixAction,
	fence?: MutationFence,
): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths, fence);
		case "remove-link-text": {
			const source = action.targetPaths[0];
			if (action.original !== undefined) {
				return replaceLinkText(app, source, action.original, action.replacement ?? "", undefined, fence);
			}
			return removeLinkText(app, source, action.linkText!, fence);
		}
		default:
			return 0;
	}
}

async function trashFiles(app: App, paths: string[], fence?: MutationFence): Promise<number> {
	let count = 0;
	for (const path of paths) {
		if (fence && !fence.ready) break;
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const ready = fence
				? await fence.mutate(file, null, () => app.fileManager.trashFile(file))
				: (await app.fileManager.trashFile(file), true);
			count++;
			if (!ready) break;
		}
	}
	return count;
}

async function removeLinkText(
	app: App,
	sourcePath: string,
	linkText: string,
	fence?: MutationFence,
): Promise<number> {
	return replaceLinkText(app, sourcePath, undefined, "", linkText, fence);
}

/**
 * Parse once per action, then splice only complete, matching source ranges.
 * The atomic read/transform/write happens inside vault.process; when a fence
 * is provided, expected content is armed synchronously before the write
 * returns so cache events can be correlated with this exact mutation.
 */
async function replaceLinkText(
	app: App,
	sourcePath: string,
	original: string | undefined,
	replacement: string,
	legacyLinkText?: string,
	fence?: MutationFence,
): Promise<number> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile) || (fence && !fence.ready)) return 0;
	let affectedCount = 0;
	const write = async (expectContent: (updated: string) => void) => {
		await app.vault.process(file, content => {
			const wiki = original === undefined || /^!?\[\[/.test(original);
			const ranges = (wiki ? wikiLinkRanges(content) : markdownLinks(content))
				.filter(({ start, end }) => {
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
			if (updated !== content) {
				affectedCount = 1;
				expectContent(updated);
			}
			return updated;
		});
	};
	if (fence) await fence.mutate(file, undefined, write);
	else await write(() => {});
	return affectedCount;
}
