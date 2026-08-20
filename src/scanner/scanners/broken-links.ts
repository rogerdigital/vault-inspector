import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import {
	getLinkTarget,
	hasUriScheme,
	resolveVaultLinkTargets,
} from "../../utils/vault-links";

type LinkCandidate = {
	linkText: string;
	fixLinkText?: string;
	ignorableUnresolvedNote: boolean;
};

type LinkReference = {
	reference: {
		link: string;
		original?: string;
	};
	isEmbed: boolean;
};

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
			const references: LinkReference[] = [
				...(cache.links ?? []).map((reference) => ({
					reference,
					isEmbed: false,
				})),
				...(cache.embeds ?? []).map((reference) => ({
					reference,
					isEmbed: true,
				})),
			];
			const linkCandidates = new Map<string, LinkCandidate>();
			const addCandidate = (candidate: LinkCandidate) => {
				const existing = linkCandidates.get(candidate.linkText);
				linkCandidates.set(candidate.linkText, {
					linkText: candidate.linkText,
					fixLinkText: existing?.fixLinkText ?? candidate.fixLinkText,
					ignorableUnresolvedNote: existing
						? existing.ignorableUnresolvedNote && candidate.ignorableUnresolvedNote
						: candidate.ignorableUnresolvedNote,
				});
			};

			for (const unresolvedLink of Object.keys(linksForFile ?? {})) {
				const matchingReferences = references.filter(
					({ reference }) => reference.link === unresolvedLink,
				);
				if (matchingReferences.length === 0) {
					addCandidate({
						linkText: unresolvedLink,
						ignorableUnresolvedNote: false,
					});
					continue;
				}
				for (const reference of matchingReferences) {
					addCandidate(getLinkCandidate(reference));
				}
			}
			for (const reference of references) {
				if (reference.reference.link.includes("#")) {
					addCandidate(getLinkCandidate(reference));
				}
			}

			for (const candidate of linkCandidates.values()) {
				issues.push(...resolveLinkIssues(
					ctx,
					file.path,
					candidate.linkText,
					candidate.fixLinkText,
					candidate.ignorableUnresolvedNote,
				));
			}
		}

		return issues;
	},
};

function resolveLinkIssues(
	ctx: ScanContext,
	sourcePath: string,
	linkText: string,
	fixLinkText: string | undefined,
	ignorableUnresolvedNote: boolean,
): Issue[] {
	const issues: Issue[] = [];

	const rawTarget = getLinkTarget(linkText);

	if (!rawTarget || hasUriScheme(rawTarget)) return issues;

	// Attachment link (has a known non-md extension)
	if (isAttachmentLink(rawTarget)) {
		if (!findResolvedPath(ctx, rawTarget, sourcePath)) {
			issues.push(
				makeIssue(
					sourcePath,
					linkText,
					fixLinkText,
					rawTarget,
					"error",
					`Attachment not found: ${rawTarget}`,
				),
			);
		}
		return issues;
	}

	// Markdown or heading link
	const linkDestination = linkText.split("|")[0];
	const headingPart = linkDestination.includes("#")
		? linkDestination.split("#").slice(1).join("#")
		: null;

	const resolvedPath = findMarkdownPath(ctx, rawTarget, sourcePath);

	if (!resolvedPath) {
		if (ctx.ignoreUnresolvedNoteLinks && ignorableUnresolvedNote) {
			return issues;
		}
		issues.push(
			makeIssue(
				sourcePath,
				linkText,
				fixLinkText,
				rawTarget,
				"error",
				`Linked file not found: ${rawTarget}`,
			),
		);
		return issues;
	}

	if (headingPart) {
		const headingCache = ctx.metadataCache.getFileCache(
			ctx.markdownFiles.find((file) => file.path === resolvedPath)!,
		);
		const headings = headingCache?.headings ?? [];
		const headingSlug = slugifyHeading(headingPart);
		const found = headings.some(
			(heading) => slugifyHeading(heading.heading) === headingSlug,
		);
		if (!found) {
			issues.push(
				makeIssue(
					sourcePath,
					linkText,
					fixLinkText,
					resolvedPath,
					"warning",
					`Heading "#${headingPart}" not found in ${resolvedPath}`,
				),
			);
		}
	}

	return issues;
}

function getLinkCandidate({ reference, isEmbed }: LinkReference): LinkCandidate {
	const original = reference.original ?? "";
	const originalWikiLink = original.match(/^!?\[\[([\s\S]+)\]\]$/);
	if (originalWikiLink) {
		return {
			linkText: originalWikiLink[1],
			fixLinkText: originalWikiLink[1],
			ignorableUnresolvedNote: !isEmbed && original.startsWith("[["),
		};
	}
	return {
		linkText: reference.link,
		ignorableUnresolvedNote: false,
	};
}

function isAttachmentLink(target: string): boolean {
	const lastSegment = target.split("/").pop() ?? "";
	const dotIndex = lastSegment.lastIndexOf(".");
	if (dotIndex === -1) return false;
	const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
	return ext !== "md";
}

function findMarkdownPath(
	ctx: ScanContext,
	linkDestination: string,
	sourcePath: string,
): string | null {
	const resolvedPath = findResolvedPath(ctx, linkDestination, sourcePath);
	return resolvedPath?.endsWith(".md") ? resolvedPath : null;
}

function findResolvedPath(
	ctx: ScanContext,
	linkDestination: string,
	sourcePath: string,
): string | null {
	if (typeof ctx.metadataCache.getFirstLinkpathDest === "function") {
		return ctx.metadataCache.getFirstLinkpathDest(
			linkDestination,
			sourcePath,
		)?.path ?? null;
	}
	return resolveVaultLinkTargets(
		ctx,
		linkDestination,
		sourcePath,
	)[0] ?? null;
}

function slugifyHeading(heading: string): string {
	return heading
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}_\s-]/gu, "")
		.replace(/\s+/g, "-");
}

function makeIssue(
	sourcePath: string,
	linkText: string,
	fixLinkText: string | undefined,
	targetPath: string,
	severity: "error" | "warning" | "info",
	message: string,
): Issue {
	const issue: Issue = {
		scannerId: "broken-links",
		severity,
		title: "Broken link",
		message,
		primaryPath: sourcePath,
		relatedPaths: [targetPath],
		evidence: { link: linkText, target: targetPath },
		...describeFinding(
			"confirmed",
			severity === "error"
				? "The link target could not be resolved in the vault."
				: "The target note exists, but the referenced heading was not found.",
			severity === "error"
				? "Correct the target or remove the link from the source note."
				: "Correct the heading reference or remove it from the source note.",
		),
		fingerprint: generateFingerprint("broken-links", sourcePath, {
			link: linkText,
			target: targetPath,
		}),
	};
	if (fixLinkText) {
		issue.fixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: `Remove "[[${fixLinkText}]]" from "${sourcePath}"`,
			targetPaths: [sourcePath],
			linkText: fixLinkText,
		};
	}
	return issue;
}
