import type { ScanContext } from "../scanner/ScanContext";
import { getBasename, getExtension, normalizePath } from "./paths";

export function getLinkTarget(linkText: string): string {
	return normalizePath(linkText.split("|")[0].split("#")[0].trim());
}

export function resolveVaultLinkTargets(
	ctx: Pick<ScanContext, "allFiles" | "filePathIndex" | "markdownFiles">,
	linkText: string,
): string[] {
	const target = getLinkTarget(linkText);
	if (!target) return [];

	const extension = getExtension(target);
	const exactCandidates = extension ? [target] : [target, `${target}.md`];
	for (const candidate of exactCandidates) {
		if (ctx.filePathIndex.has(candidate)) return [candidate];
	}

	if (target.includes("/")) return [];

	if (extension) {
		const matches = ctx.allFiles
			.map((file) => file.path)
			.filter((path) => normalizePath(path).split("/").pop() === target)
			.sort();
		return matches;
	}

	const matches = ctx.markdownFiles
		.map((file) => file.path)
		.filter((path) => getBasename(path) === target)
		.sort();
	return matches;
}
