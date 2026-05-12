import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isAttachment } from "../../utils/file-types";

const ATTACHMENT_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"pdf",
	"mp3",
	"mp4",
	"wav",
	"mov",
	"zip",
]);

export const orphanAttachmentsScanner = {
	id: "orphan-attachments" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const referencedPaths = collectReferencedPaths(ctx);

		for (const file of ctx.allFiles) {
			if (isIgnored(file.path, ctx.ignoredFolders)) continue;
			if (!isAttachment(file.path)) continue;

			const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
			if (!ATTACHMENT_EXTENSIONS.has(ext)) continue;

			if (!referencedPaths.has(file.path)) {
				const severity = isRecent(file.stat.mtime) ? "info" : "warning";
				issues.push({
					scannerId: "orphan-attachments",
					severity,
					title: "Orphan attachment",
					message: "This attachment is not referenced by any note",
					primaryPath: file.path,
					relatedPaths: [],
					evidence: {
						lastModified: file.stat.mtime,
					},
					fingerprint: generateFingerprint("orphan-attachments", file.path, {
						orphan: true,
					}),
				});
			}
		}

		return issues;
	},
};

function collectReferencedPaths(ctx: ScanContext): Set<string> {
	const paths = new Set<string>();

	for (const file of ctx.markdownFiles) {
		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;

		const links = cache.links ?? [];
		const embeds = cache.embeds ?? [];

		for (const link of [...links, ...embeds]) {
			const resolvedMeta = ctx.metadataCache as unknown as {
				resolvedLinks?: Record<string, Record<string, string>>;
			};
			const resolved = resolvedMeta.resolvedLinks?.[file.path]?.[link.link];
			if (typeof resolved === "string") {
				paths.add(resolved);
			} else {
				// Try direct path match
				const linkPath = link.link.split("#")[0].split("|")[0];
				if (ctx.filePathIndex.has(linkPath)) {
					paths.add(linkPath);
				}
			}
		}
	}

	return paths;
}

function isIgnored(path: string, ignoredFolders: string[]): boolean {
	for (const folder of ignoredFolders) {
		if (path.startsWith(folder + "/") || path === folder) return true;
	}
	return false;
}

function isRecent(mtime: number): boolean {
	const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return mtime > oneWeekAgo;
}
