import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isAttachment } from "../../utils/file-types";
import { isIgnoredPath } from "../../utils/paths";
import { resolveVaultLinkTargets } from "../../utils/vault-links";

export const orphanAttachmentsScanner = {
	id: "orphan-attachments" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const referencedPaths = collectReferencedPaths(ctx);

		for (const file of ctx.allFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;
			if (!isAttachment(file.path)) continue;

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
					...describeFinding(
						"candidate",
						"No Markdown note references this attachment within the scanned vault metadata.",
						"Review external and generated references before moving the file to trash.",
						"CSS, Canvas, Dataview, publishing pipelines, and external tools can reference files outside this scan boundary.",
					),
					fingerprint: generateFingerprint("orphan-attachments", file.path, {
						orphan: true,
					}),
					fixAction: {
						kind: "trash-file",
						label: "Delete",
						description: `Move "${file.path}" to trash`,
						targetPaths: [file.path],
					},
				});
			}
		}

		return issues;
	},
};

function collectReferencedPaths(ctx: ScanContext): Set<string> {
	const paths = new Set<string>();
	const canResolveLinks =
		typeof ctx.metadataCache.getFirstLinkpathDest === "function";

	for (const file of ctx.markdownFiles) {
		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;

		const links = cache.links ?? [];
		const embeds = cache.embeds ?? [];
		const frontmatterLinks = cache.frontmatterLinks ?? [];

		for (const link of [...links, ...embeds, ...frontmatterLinks]) {
			const resolvedTarget = canResolveLinks
				? ctx.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path
				: resolveVaultLinkTargets(ctx, link.link, file.path)[0];
			if (resolvedTarget) paths.add(resolvedTarget);
		}
	}

	return paths;
}

function isRecent(mtime: number): boolean {
	const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return mtime > oneWeekAgo;
}
