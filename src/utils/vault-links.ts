import type { ScanContext } from "../scanner/ScanContext";
import { getBasename, getExtension, normalizePath } from "./paths";

type LinkIndexes = {
	fileNameToPaths: Map<string, string[]>;
	markdownBaseToPaths: Map<string, string[]>;
};

const indexCache = new WeakMap<object, LinkIndexes>();

export function getLinkTarget(linkText: string): string {
	return normalizePath(linkText.split("|")[0].split("#")[0].trim());
}

export function resolveVaultLinkTargets(
	ctx: Pick<ScanContext, "allFiles" | "filePathIndex" | "markdownFiles">,
	linkText: string,
	sourcePath?: string,
): string[] {
	const target = getLinkTarget(linkText);
	if (!target || hasUriScheme(target)) return [];

	const extension = getExtension(target);
	const relativeTarget = sourcePath && /^\.{1,2}\//.test(target)
		? resolveRelativePath(sourcePath, target)
		: null;
	const sourceFolderTarget = sourcePath && !target.includes("/")
		? resolveRelativePath(sourcePath, `./${target}`)
		: null;
	const candidateTargets = relativeTarget
		? [relativeTarget]
		: sourceFolderTarget
			? [sourceFolderTarget, target]
			: [target];
	const exactCandidates = candidateTargets.flatMap((candidate) =>
		extension ? [candidate] : [candidate, `${candidate}.md`],
	);
	for (const candidate of exactCandidates) {
		if (ctx.filePathIndex.has(candidate)) return [candidate];
	}

	if (target.includes("/")) return [];

	const indexes = getLinkIndexes(ctx);
	if (extension) {
		return (indexes.fileNameToPaths.get(target) ?? []).slice(0, 1);
	}

	return (indexes.markdownBaseToPaths.get(target) ?? []).slice(0, 1);
}

export function hasUriScheme(text: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(text);
}

function resolveRelativePath(sourcePath: string, target: string): string {
	const segments = normalizePath(sourcePath).split("/");
	segments.pop();
	for (const segment of normalizePath(target).split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
		} else {
			segments.push(segment);
		}
	}
	return segments.join("/");
}

function getLinkIndexes(
	ctx: Pick<ScanContext, "allFiles" | "filePathIndex" | "markdownFiles">,
): LinkIndexes {
	const cached = indexCache.get(ctx);
	if (cached) return cached;

	const fileNameToPaths = new Map<string, string[]>();
	for (const file of ctx.allFiles) {
		const normalizedPath = normalizePath(file.path);
		const fileName = normalizedPath.split("/").pop();
		if (!fileName) continue;
		const paths = fileNameToPaths.get(fileName) ?? [];
		paths.push(file.path);
		fileNameToPaths.set(fileName, paths);
	}

	const markdownBaseToPaths = new Map<string, string[]>();
	for (const file of ctx.markdownFiles) {
		const baseName = getBasename(file.path);
		const paths = markdownBaseToPaths.get(baseName) ?? [];
		paths.push(file.path);
		markdownBaseToPaths.set(baseName, paths);
	}

	for (const paths of fileNameToPaths.values()) paths.sort();
	for (const paths of markdownBaseToPaths.values()) paths.sort();

	const indexes = { fileNameToPaths, markdownBaseToPaths };
	indexCache.set(ctx, indexes);
	return indexes;
}
