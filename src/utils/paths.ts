export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
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
