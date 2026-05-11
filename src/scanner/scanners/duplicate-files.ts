import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { hashContent } from "../../utils/hash";

export const duplicateFilesScanner = {
	id: "duplicate-files" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const hashGroups = new Map<string, string[]>();

		for (const file of ctx.allFiles) {
			if (isIgnored(file.path, ctx.ignoredFolders)) continue;
			if (file.stat.size === 0) continue;

			let hash: string;

			if (file.stat.size <= ctx.duplicateHashMaxBytes) {
				try {
					const content = await ctx.vault.readBinary(file);
					hash = await hashContent(content);
				} catch {
					continue;
				}
			} else {
				// Use size as a rough fingerprint for oversized files
				hash = `size:${file.stat.size}`;
			}

			const group = hashGroups.get(hash);
			if (group) {
				group.push(file.path);
			} else {
				hashGroups.set(hash, [file.path]);
			}
		}

		for (const [, paths] of hashGroups) {
			if (paths.length < 2) continue;

			issues.push({
				scannerId: "duplicate-files",
				severity: "warning",
				title: "Duplicate file candidates",
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

		return issues;
	},
};

function isIgnored(path: string, ignoredFolders: string[]): boolean {
	for (const folder of ignoredFolders) {
		if (path.startsWith(folder + "/") || path === folder) return true;
	}
	return false;
}
