import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isAttachment } from "../../utils/file-types";
import { isIgnoredPath } from "../../utils/paths";
import {
	isReferenced,
	type ReferenceCoverageFailure,
} from "../reference-index";

export const orphanAttachmentsScanner = {
	id: "orphan-attachments" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const index = ctx.referenceIndex;

		for (const file of ctx.allFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;
			if (!isAttachment(file.path)) continue;
			if (isReferenced(index, file.path)) continue;

			const severity = isRecent(file.stat.mtime) ? "info" : "warning";
			issues.push({
				scannerId: "orphan-attachments",
				severity,
				title: "Orphan attachment",
				message: "This attachment is not referenced by any note",
				primaryPath: file.path,
				relatedPaths: [],
				evidence: {
					size: file.stat.size,
					lastModified: file.stat.mtime,
					// Referenced files are skipped above, so this is always 0;
					// recorded to make "no inbound references" explicit evidence.
					referenceCount: 0,
					coverageComplete: index.coverageComplete,
				},
				...describeFinding(
					"candidate",
					"No note, embed, frontmatter link, or Canvas file node in the vault references this attachment.",
					index.coverageComplete
						? "Review external and generated references before moving the file to trash."
						: "Resolve the incomplete reference coverage below before moving the file to trash.",
					"CSS, Dataview, publishing pipelines, and external tools can reference files outside this scan boundary.",
				),
				fingerprint: generateFingerprint("orphan-attachments", file.path, {
					orphan: true,
				}),
				// Delete eligibility requires complete reference coverage:
				// unresolved Canvas content could reference this file.
				...(index.coverageComplete
					? {
							fixAction: {
								kind: "trash-file" as const,
								label: "Delete",
								description: `Move "${file.path}" to trash`,
								targetPaths: [file.path],
							},
						}
					: {}),
			});
		}

		if (index.coverageFailures.length > 0) {
			issues.push(buildCoverageFinding(index.coverageFailures));
		}

		return issues;
	},
};

function buildCoverageFinding(failures: ReferenceCoverageFailure[]): Issue {
	const sorted = [...failures].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	const failedPaths = sorted.map((failure) => failure.path);
	const reasons = [...new Set(sorted.map((failure) => failure.reason))].sort().join(",");
	return {
		scannerId: "orphan-attachments",
		severity: "info",
		title: "Reference coverage incomplete",
		message: `${failedPaths.length} Canvas file${failedPaths.length === 1 ? "" : "s"} could not be parsed (${reasons}); orphan results may be incomplete`,
		primaryPath: failedPaths[0],
		relatedPaths: failedPaths,
		evidence: {
			failedCount: failedPaths.length,
			failedPaths: failedPaths.join(","),
			reasons,
		},
		...describeFinding(
			"unverified",
			"Canvas reference sources could not be fully parsed, so the absence of references for some attachments is not yet trustworthy.",
			"Fix or remove the malformed Canvas file(s) listed here, then rescan.",
		),
		fingerprint: generateFingerprint("orphan-attachments", failedPaths[0], {
			coverageFailure: true,
			paths: failedPaths.join(","),
		}),
	};
}

function isRecent(mtime: number): boolean {
	const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return mtime > oneWeekAgo;
}
