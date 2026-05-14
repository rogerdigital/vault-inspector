import { App, TFile } from "obsidian";
import type { FixAction } from "../scanner/Issue";

export async function executeFixAction(app: App, action: FixAction): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths);
		case "remove-link-text":
			return removeLinkText(app, action.targetPaths[0], action.linkText!);
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
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return 0;

	const content = await app.vault.read(file);
	const target = linkText.split("|")[0].split("#")[0];
	const escaped = escapeRegex(target);
	const pattern = new RegExp(
		`!?\\[\\[${escaped}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`,
		"g",
	);

	const updated = content.replace(pattern, "");
	if (updated === content) return 0;

	await app.vault.modify(file, updated);
	return 1;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
