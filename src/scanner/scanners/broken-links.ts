import type { LinkDestination, LinkReference as MetadataLinkReference } from "../link-reference";
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

type LinkFix = {
	/** Verbatim source syntax (from LinkCache.original / EmbedCache.original). */
	original: string;
	/** Text left in place of `original`; "" removes the range (embeds). */
	replacement: string;
};

type LinkCandidate = {
	destination?: LinkDestination;
	linkText: string;
	fixLinkText?: string;
	fix?: LinkFix;
	isEmbed: boolean;
	isMarkdown: boolean;
	ignorableUnresolvedNote: boolean;
};

type LinkReference = {
	reference: MetadataLinkReference;
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
				const destination = candidate.destination;
				const key = destination
					? JSON.stringify([candidate.linkText, destination.path, destination.fragment, destination.resolvedPath])
					: candidate.linkText;
				const existing = linkCandidates.get(key);
				if (!existing) {
					linkCandidates.set(key, candidate);
					return;
				}
				linkCandidates.set(key, {
					linkText: candidate.linkText,
					destination: candidate.destination,
					fixLinkText: existing.fixLinkText ?? candidate.fixLinkText,
					// A fix targets one exact source range. When merged references
					// disagree on the original syntax (plain vs aliased, wiki vs
					// markdown, embed vs non-embed) or one of them has no original,
					// a single action cannot cover every occurrence — withhold it
					// and keep the finding reviewable.
					fix: existing.fix && candidate.fix
						&& existing.fix.original === candidate.fix.original
						? existing.fix
						: undefined,
					isEmbed: existing.isEmbed || candidate.isEmbed,
					isMarkdown: existing.isMarkdown || candidate.isMarkdown,
					ignorableUnresolvedNote:
						existing.ignorableUnresolvedNote && candidate.ignorableUnresolvedNote,
				});
			};

			for (const unresolvedLink of Object.keys(linksForFile ?? {})) {
				const matchingReferences = references.filter(
					({ reference }) => reference.link === unresolvedLink,
				);
				if (matchingReferences.length === 0) {
					addCandidate({
						linkText: unresolvedLink,
						isEmbed: false,
						isMarkdown: false,
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
				issues.push(...resolveLinkIssues(ctx, file.path, candidate));
			}
		}

		return issues;
	},
};

function resolveLinkIssues(
	ctx: ScanContext,
	sourcePath: string,
	candidate: LinkCandidate,
): Issue[] {
	const issues: Issue[] = [];
	const linkText = candidate.linkText;

	const destination = candidate.destination;
	const rawTarget = destination ? destination.path : getLinkTarget(linkText);
	const linkDestination = linkText.split("|")[0];
	const headingPart = destination ? destination.fragment : linkDestination.includes("#")
		? linkDestination.split("#").slice(1).join("#")
		: null;
	const sameNote = rawTarget === "" && Boolean(headingPart);

	if ((!rawTarget && !sameNote) || hasUriScheme(rawTarget)) return issues;

	// Attachment link (has a known non-md extension)
	if (isAttachmentLink(rawTarget)) {
		if (!(destination ? destination.resolvedPath : findResolvedPath(ctx, rawTarget, sourcePath))) {
			issues.push(
				makeIssue(
					sourcePath,
					candidate,
					rawTarget,
					"error",
					`Attachment not found: ${rawTarget}`,
					candidate.isEmbed ? "embed" : "attachment",
				),
			);
		}
		return issues;
	}

	// Markdown or heading link
	const resolvedPath = destination
		? destination.resolvedPath?.endsWith(".md") ? destination.resolvedPath : null
		: sameNote ? sourcePath : findMarkdownPath(ctx, rawTarget, sourcePath);

	if (!resolvedPath) {
		if (ctx.ignoreUnresolvedNoteLinks && candidate.ignorableUnresolvedNote) {
			return issues;
		}
		issues.push(
			makeIssue(
				sourcePath,
				candidate,
				rawTarget,
				"error",
				`Linked file not found: ${rawTarget}`,
				candidate.isEmbed
					? "embed"
					: candidate.isMarkdown
						? "markdown-link"
						: "note-link",
			),
		);
		return issues;
	}

	if (headingPart) {
		const targetCache = ctx.metadataCache.getFileCache(
			ctx.markdownFiles.find((file) => file.path === resolvedPath)!,
		);
		const isBlock = headingPart.startsWith("^");
		const found = isBlock
			? Object.keys(targetCache?.blocks ?? {}).some(
				(id) => id.toLowerCase() === headingPart.slice(1).toLowerCase(),
			)
			: (targetCache?.headings ?? []).some(
				(heading) => slugifyHeading(heading.heading) === slugifyHeading(headingPart),
			);
		if (!found) {
			issues.push(
				makeIssue(
					sourcePath,
					candidate,
					resolvedPath,
					"warning",
					`${isBlock ? "Block" : "Heading"} "#${headingPart}" not found in ${resolvedPath}`,
					candidate.isEmbed
						? "embed"
						: candidate.isMarkdown
							? "markdown-link"
							: "heading",
					isBlock ? "block" : "heading",
				),
			);
		}
	}

	return issues;
}

function getLinkCandidate({ reference, isEmbed }: LinkReference): LinkCandidate {
	const original = reference.original ?? "";
	const wikiMatch = original.match(/^(!?)\[\[([\s\S]+)\]\]$/);
	if (wikiMatch) {
		const inner = wikiMatch[2];
		return {
			// Obsidian's LinkCache.link already strips the alias, so the candidate
			// key must use it — the full inner text survives only as fix text.
			linkText: reference.link,
			destination: reference.destination,
			fixLinkText: inner,
			fix: {
				original,
				// Embeds render their target, not their text: removal is the
				// only faithful transform.
				replacement: wikiMatch[1] ? "" : deriveWikiReplacement(inner),
			},
			isEmbed,
			isMarkdown: false,
			ignorableUnresolvedNote: !isEmbed && !wikiMatch[1],
		};
	}
	const markdownMatch = original.match(/^(!?)\[([^\]]*)\]\(\s*(?:<[^>]+>|[^)\s]*)\s*\)$/);
	if (markdownMatch) {
		return {
			linkText: reference.link,
			destination: reference.destination,
			fix: {
				original,
				replacement: markdownMatch[1] ? "" : markdownMatch[2],
			},
			isEmbed: Boolean(markdownMatch[1]),
			isMarkdown: true,
			ignorableUnresolvedNote: false,
		};
	}
	return {
		linkText: reference.link,
		destination: reference.destination,
		isEmbed,
		isMarkdown: !isEmbed && original.startsWith("["),
		ignorableUnresolvedNote: false,
	};
}

/** Wiki replacement text: the alias when present, otherwise the inner text. */
function deriveWikiReplacement(inner: string): string {
	const pipeIndex = inner.indexOf("|");
	return pipeIndex === -1 ? inner : inner.slice(pipeIndex + 1);
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
	candidate: LinkCandidate,
	targetPath: string,
	severity: "error" | "warning" | "info",
	message: string,
	linkKind: "note-link" | "markdown-link" | "attachment" | "heading" | "embed",
	referenceKind: "block" | "heading" = "heading",
): Issue {
	const fragmentAt = candidate.linkText.indexOf("#");
	const rawFragment = fragmentAt === -1 ? null : candidate.linkText.slice(fragmentAt + 1);
	const resolvedFragment = candidate.destination?.fragment;
	// Preserve native/raw identities, distinguishing only fragments decoded by the adapter.
	const fragmentIdentity: Record<string, string> = resolvedFragment != null && resolvedFragment !== rawFragment
		? { resolvedFragment }
		: {};
	const issue: Issue = {
		scannerId: "broken-links",
		severity,
		title: "Broken link",
		message,
		primaryPath: sourcePath,
		relatedPaths: [targetPath],
		evidence: { link: candidate.linkText, target: targetPath, linkKind },
		...describeFinding(
			"confirmed",
			severity === "error"
				? "The link target could not be resolved in the vault."
				: `The target note exists, but the referenced ${referenceKind} was not found.`,
			severity === "error"
				? "Correct the target or remove the link from the source note."
				: `Correct the ${referenceKind} reference or remove it from the source note.`,
		),
		fingerprint: generateFingerprint("broken-links", sourcePath, {
			link: candidate.linkText,
			target: targetPath,
			...fragmentIdentity,
		}),
	};
	if (candidate.fix) {
		const fix = candidate.fix;
		issue.fixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: fix.replacement === ""
				? `Remove "${fix.original}" from "${sourcePath}"`
				: `Replace "${fix.original}" with "${fix.replacement}" in "${sourcePath}"`,
			targetPaths: [sourcePath],
			...(candidate.fixLinkText ? { linkText: candidate.fixLinkText } : {}),
			original: fix.original,
			replacement: fix.replacement,
		};
	}
	return issue;
}
