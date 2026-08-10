import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { hashContent } from "../../utils/hash";
import { getBasename, getExtension, isIgnoredPath } from "../../utils/paths";
import { formatSize } from "../../utils/format";

export const duplicateFilesScanner = {
	id: "duplicate-files" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const files = ctx.allFiles.filter(
			(f) => f.stat.size > 0 && !isIgnoredPath(f.path, ctx.ignoredFolders),
		);

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

		// Phase 3: hash candidates below cap
		const hashGroups = new Map<string, string[]>();
		for (const file of candidates) {
			if (file.stat.size <= ctx.duplicateHashMaxBytes) {
				try {
					const content = await ctx.vault.readBinary(file);
					const hash = await hashContent(content);
					const group = hashGroups.get(hash) ?? [];
					group.push(file.path);
					hashGroups.set(hash, group);
				} catch {
					continue;
				}
			}
		}

		// Report hash-identical as warning
		const hashReportedPaths = new Set<string>();
		for (const [, paths] of hashGroups) {
			if (paths.length < 2) continue;
			paths.forEach((p) => hashReportedPaths.add(p));
			const sorted = paths.slice().sort();
			const kept = sorted[0];
			const duplicates = sorted.slice(1);
			issues.push({
				scannerId: "duplicate-files",
				severity: "warning",
				title: "Duplicate files (hash-identical)",
				message: `${paths.length} files have identical content`,
				relatedPaths: paths,
				evidence: {
					count: paths.length,
					paths: paths.join(", "),
				},
				...describeFinding(
					"confirmed",
					`SHA-256 content hashes match across ${paths.length} files.`,
					"Choose the file to keep before moving the remaining copies to trash.",
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
					},
				},
			});
		}

		// Report name candidates not covered by hash as info
		for (const [name, group] of nameGroups) {
			if (group.length < 2) continue;
			const unreached = group.filter((f) => !hashReportedPaths.has(f.path));
			if (unreached.length < 2) continue;
			const paths = unreached.map((f) => f.path);
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same name)",
				message: `${paths.length} files share the name "${name}"`,
				relatedPaths: paths,
				evidence: {
					count: paths.length,
					paths: paths.join(", "),
				},
				...describeFinding(
					"candidate",
					`${paths.length} files share the same filename.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching names do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					nameCandidates: paths.slice().sort().join(","),
				}),
			});
		}

		// Report size candidates not covered by hash as info
		for (const [size, group] of sizeGroups) {
			if (group.length < 2) continue;
			const unreached = group.filter((f) => !hashReportedPaths.has(f.path));
			if (unreached.length < 2) continue;
			const paths = unreached.map((f) => f.path);
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same size)",
				message: `${paths.length} files share size ${formatSize(size)}`,
				relatedPaths: paths,
				evidence: {
					count: paths.length,
					size,
					paths: paths.join(", "),
				},
				...describeFinding(
					"candidate",
					`${paths.length} files share the same byte size.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching sizes do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					sizeCandidates: paths.slice().sort().join(","),
				}),
			});
		}

		return issues;
	},
};
