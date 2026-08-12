export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getParentFolder(path: string): string | null {
	const normalized = normalizePath(path);
	const slashIndex = normalized.lastIndexOf("/");
	if (slashIndex <= 0) return null;
	return normalized.slice(0, slashIndex);
}

export function getExtension(path: string): string {
	const normalized = normalizePath(path);
	const dotIndex = normalized.lastIndexOf(".");
	if (dotIndex === -1 || dotIndex < normalized.lastIndexOf("/")) return "";
	return normalized.slice(dotIndex + 1).toLowerCase();
}

export function getBasename(path: string): string {
	const normalized = normalizePath(path);
	const slashIndex = normalized.lastIndexOf("/");
	const name = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
	const dotIndex = name.lastIndexOf(".");
	return dotIndex === -1 ? name : name.slice(0, dotIndex);
}

export function isInFolder(path: string, folder: string): boolean {
	const normalized = normalizePath(path);
	const normalizedFolder = normalizePath(folder).replace(/\/+$/, "");
	return (
		normalized === normalizedFolder ||
		normalized.startsWith(normalizedFolder + "/")
	);
}

export function isIgnoredPath(path: string, ignoredFolders: string[]): boolean {
	return ignoredFolders.some((folder) => isInFolder(path, folder));
}

export function matchesGlob(path: string, glob: string): boolean {
	const globstarSlashPlaceholder = "__VI_GLOBSTAR_SLASH__";
	const globstarPlaceholder = "__VI_GLOBSTAR__";
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*\//g, globstarSlashPlaceholder)
		.replace(/\*\*/g, globstarPlaceholder)
		.replace(/\*/g, "[^/]*");
	const pattern = escaped
		.split(globstarSlashPlaceholder).join("(?:.*/)?")
		.split(globstarPlaceholder).join(".*");
	return new RegExp(`^${pattern}$`).test(path);
}
