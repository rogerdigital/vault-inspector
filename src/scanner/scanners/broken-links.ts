import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import { getLinkTarget, resolveVaultLinkTargets } from "../../utils/vault-links";

export const brokenLinksScanner = {
	id: "broken-links" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const { markdownFiles, metadataCache } = ctx;

		for (const file of markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const cache = metadataCache.getFileCache(file);
			if (!cache) continue;

			const meta = metadataCache as unknown as {
				unresolvedLinks?: Record<string, Record<string, number>>;
			};
			const linksForFile = meta.unresolvedLinks?.[file.path];
			if (!linksForFile) continue;

			for (const linkText of Object.keys(linksForFile)) {
				issues.push(...resolveLinkIssues(ctx, file.path, linkText));
			}
		}

		return issues;
	},
};

function resolveLinkIssues(
	ctx: ScanContext,
	sourcePath: string,
	linkText: string,
): Issue[] {
	const issues: Issue[] = [];

	const rawTarget = getLinkTarget(linkText);

	if (!rawTarget) return issues;

	// Attachment link (has a known non-md extension)
	if (isAttachmentLink(rawTarget)) {
		if (resolveVaultLinkTargets(ctx, linkText).length === 0) {
			issues.push(
				makeIssue(ctx, sourcePath, linkText, rawTarget, "error", `Attachment not found: ${rawTarget}`),
			);
		}
		return issues;
	}

	// Markdown or heading link
	const headingPart = linkText.includes("#") ? linkText.split("#").slice(1).join("#") : null;

	const resolvedPath = findMarkdownPath(ctx, linkText);

	if (!resolvedPath) {
		issues.push(
			makeIssue(ctx, sourcePath, linkText, rawTarget, "error", `Linked file not found: ${rawTarget}`),
		);
		return issues;
	}

	// Check heading existence
	if (headingPart) {
		const headingCache = ctx.metadataCache.getFileCache(
			ctx.markdownFiles.find((f) => f.path === resolvedPath)!,
		);
		const headings = headingCache?.headings ?? [];
		const headingSlug = slugifyHeading(headingPart);
		const found = headings.some(
			(h) => slugifyHeading(h.heading) === headingSlug,
		);
		if (!found) {
			issues.push(
				makeIssue(
					ctx,
					sourcePath,
					linkText,
					resolvedPath,
					"warning",
					`Heading "#${headingPart}" not found in ${resolvedPath}`,
				),
			);
		}
	}

	return issues;
}

function isAttachmentLink(target: string): boolean {
	const lastSegment = target.split("/").pop() ?? "";
	const dotIndex = lastSegment.lastIndexOf(".");
	if (dotIndex === -1) return false;
	const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
	return ext !== "md";
}

function findMarkdownPath(ctx: ScanContext, linkText: string): string | null {
	const resolvedTargets = resolveVaultLinkTargets(ctx, linkText)
		.filter((path) => path.endsWith(".md"));
	return resolvedTargets[0] ?? null;
}

function slugifyHeading(heading: string): string {
	return heading
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}_\s-]/gu, "")
		.replace(/\s+/g, "-");
}

function makeIssue(
	_ctx: ScanContext,
	sourcePath: string,
	linkText: string,
	targetPath: string,
	severity: "error" | "warning" | "info",
	message: string,
): Issue {
	return {
		scannerId: "broken-links",
		severity,
		title: "Broken link",
		message,
		primaryPath: sourcePath,
		relatedPaths: [targetPath],
		evidence: { link: linkText, target: targetPath },
		fingerprint: generateFingerprint("broken-links", sourcePath, {
			link: linkText,
			target: targetPath,
		}),
		fixAction: {
			kind: "remove-link-text",
			label: "Remove link",
			description: `Remove "[[${linkText}]]" from "${sourcePath}"`,
			targetPaths: [sourcePath],
			linkText,
		},
	};
}
