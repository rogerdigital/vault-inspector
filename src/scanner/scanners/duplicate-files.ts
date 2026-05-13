import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
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
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					paths: paths.slice().sort().join(","),
				}),
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
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					sizeCandidates: paths.slice().sort().join(","),
				}),
			});
		}

		return issues;
	},
};
