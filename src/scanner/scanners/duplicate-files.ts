import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { hashContent } from "../../utils/hash";
import { getBasename, getExtension, isIgnoredPath } from "../../utils/paths";
import { formatSize } from "../../utils/format";
import { getInboundReference, type ReferenceIndex } from "../reference-index";

/**
 * Why a candidate file's content identity is or is not known:
 * - "hash-confirmed": SHA-256 was computed. On the warning finding this means
 *   byte-identical to the group; on a candidate finding it means the hash was
 *   compared and no identical copy exists.
 * - "cap-exceeded": above duplicateHashMaxBytes; identity unknown.
 * - "read-failed": vault.readBinary threw; identity unknown.
 */
type HashState = "hash-confirmed" | "cap-exceeded" | "read-failed";

export const duplicateFilesScanner = {
	id: "duplicate-files" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const files = ctx.allFiles.filter(
			(f) => f.stat.size > 0 && !isIgnoredPath(f.path, ctx.ignoredFolders),
		);
		const filesByPath = new Map(files.map((file) => [file.path, file]));
		const index = ctx.referenceIndex;
		const inboundCount = (path: string): number =>
			getInboundReference(index, path)?.count ?? 0;

		// Phase 1: group by basename + extension
		const nameGroups = new Map<string, typeof files>();
		for (const file of files) {
			const key = `${getBasename(file.path)}.${getExtension(file.path)}`;
			const group = nameGroups.get(key) ?? [];
			group.push(file);
			nameGroups.set(key, group);
		}

		// Phase 2: group by byte size
		const sizeGroups = new Map<number, typeof files>();
		for (const file of files) {
			const group = sizeGroups.get(file.stat.size) ?? [];
			group.push(file);
			sizeGroups.set(file.stat.size, group);
		}

		// Collect candidate files (appear in a group of 2+)
		const candidates = new Set<typeof files[number]>();
		for (const [, group] of nameGroups) {
			if (group.length >= 2) group.forEach((f) => candidates.add(f));
		}
		for (const [, group] of sizeGroups) {
			if (group.length >= 2) group.forEach((f) => candidates.add(f));
		}

		// Phase 3: hash candidates below cap, tracking per-file hash state
		const hashGroups = new Map<string, string[]>();
		const hashStates = new Map<string, HashState>();
		for (const file of candidates) {
			if (file.stat.size > ctx.duplicateHashMaxBytes) {
				hashStates.set(file.path, "cap-exceeded");
				continue;
			}
			try {
				const content = await ctx.vault.readBinary(file);
				const hash = await hashContent(content);
				hashStates.set(file.path, "hash-confirmed");
				const group = hashGroups.get(hash) ?? [];
				group.push(file.path);
				hashGroups.set(hash, group);
			} catch {
				hashStates.set(file.path, "read-failed");
			}
		}

		// Per-file evidence aligned BY INDEX with each finding's relatedPaths.
		const referenceCountsOf = (sorted: string[]) =>
			sorted.map(inboundCount).join(",");
		const mtimesOf = (sorted: string[]) =>
			sorted.map((path) => filesByPath.get(path)?.stat.mtime ?? 0).join(",");

		// Report hash-identical as warning
		const hashReportedPaths = new Set<string>();
		for (const [, paths] of hashGroups) {
			if (paths.length < 2) continue;
			paths.forEach((p) => hashReportedPaths.add(p));
			const sorted = paths.slice().sort();
			const referencedPaths = sorted.filter((path) => inboundCount(path) > 0);
			const requiresReview = referencedPaths.length >= 2;
			const kept = pickAutomaticKeepPath(sorted, index);
			const duplicates = sorted.filter((path) => path !== kept);
			issues.push({
				scannerId: "duplicate-files",
				severity: "warning",
				title: "Duplicate files (hash-identical)",
				message: `${paths.length} files have identical content`,
				primaryPath: undefined,
				relatedPaths: sorted,
				evidence: {
					count: paths.length,
					paths: paths.join(", "),
					hashState: "hash-confirmed",
					referenceCounts: referenceCountsOf(sorted),
					mtimes: mtimesOf(sorted),
					referencedPaths: referencedPaths.join(","),
				},
				...describeFinding(
					"confirmed",
					`SHA-256 content hashes match across ${paths.length} files.`,
					requiresReview
						? "Several copies are referenced from notes. Review which location to keep before moving any copy to trash."
						: "Choose the file to keep before moving the remaining copies to trash.",
					"The files are byte-identical, but their locations can still serve different workflows.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					paths: sorted.join(","),
				}),
				fixAction: {
					kind: "trash-file",
					label: "Delete duplicates",
					description: `Keep "${kept}" and move ${duplicates.length} duplicate(s) to trash`,
					targetPaths: duplicates,
					selection: {
						kind: "keep-one",
						candidatePaths: sorted,
						automaticKeepPath: kept,
						referencedPaths,
						requiresReview,
					},
				},
			});
		}

		// Report name candidates not covered by hash as info
		for (const [name, group] of nameGroups) {
			if (group.length < 2) continue;
			const unreached = group
				.filter((f) => !hashReportedPaths.has(f.path))
				.map((f) => f.path)
				.sort();
			if (unreached.length < 2) continue;
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same name)",
				message: `${unreached.length} files share the name "${name}"`,
				relatedPaths: unreached,
				evidence: {
					count: unreached.length,
					paths: unreached.join(", "),
					hashStates: statesOf(hashStates, unreached),
					referenceCounts: referenceCountsOf(unreached),
					mtimes: mtimesOf(unreached),
				},
				...describeFinding(
					"candidate",
					`${unreached.length} files share the same filename.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching names do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					nameCandidates: unreached.join(","),
				}),
			});
		}

		// Report size candidates not covered by hash as info
		for (const [size, group] of sizeGroups) {
			if (group.length < 2) continue;
			const unreached = group
				.filter((f) => !hashReportedPaths.has(f.path))
				.map((f) => f.path)
				.sort();
			if (unreached.length < 2) continue;
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same size)",
				message: `${unreached.length} files share size ${formatSize(size)}`,
				relatedPaths: unreached,
				evidence: {
					count: unreached.length,
					paths: unreached.join(", "),
					hashStates: statesOf(hashStates, unreached),
					referenceCounts: referenceCountsOf(unreached),
					mtimes: mtimesOf(unreached),
					size,
				},
				...describeFinding(
					"candidate",
					`${unreached.length} files share the same byte size.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching sizes do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					sizeCandidates: unreached.join(","),
				}),
			});
		}

		return issues;
	},
};

/**
 * Automatic keep policy: the path with the highest inbound reference count
 * wins; equal counts break to the lexicographically smallest vault-relative
 * path so the choice is deterministic.
 */
function pickAutomaticKeepPath(
	paths: string[],
	index: ReferenceIndex,
): string {
	let best = paths[0];
	let bestCount = getInboundReference(index, best)?.count ?? 0;
	for (const path of paths.slice(1)) {
		const count = getInboundReference(index, path)?.count ?? 0;
		if (count > bestCount || (count === bestCount && path < best)) {
			best = path;
			bestCount = count;
		}
	}
	return best;
}

function statesOf(
	hashStates: Map<string, HashState>,
	paths: string[],
): string {
	return [...new Set(paths.map((path) => hashStates.get(path) ?? "cap-exceeded"))]
		.sort()
		.join(",");
}
