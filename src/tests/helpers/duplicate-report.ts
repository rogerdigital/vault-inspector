import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { runCli } from "../../../cli/cli";
import type { Issue } from "../../scanner/Issue";
import { generateFingerprint } from "../../scanner/issue-fingerprint";

export const duplicatePathCases = [
	["b.png", "a,one.png"],
	["中文，副本.png", "b copy.png", "a, one.png"],
];

/** Exercise the real scanner and public JSON before rendering its finding. */
export async function scanDuplicatePaths(paths: string[]): Promise<Issue> {
	const root = await mkdtemp(join(tmpdir(), "vi-duplicate-report-"));
	try {
		for (const path of paths) await writeFile(join(root, path), "identical bytes");
		// Give the first input two references so the comma-named copy is a trash target.
		await writeFile(join(root, "Source.md"), [...paths, paths[0]!].map((path) => `![copy](<${path}#fragment>)`).join("\n"));
		const output = await runCli([root, "--scanner", "duplicate-files", "--format", "json", "--fail-on", "none"]);
		expect(output.stderr).toBe("");
		expect(output.exitCode).toBe(0);
		const payload = JSON.parse(output.stdout) as { schemaVersion: number; issues: Issue[] };
		expect(payload.schemaVersion).toBe(1);
		expect(payload.issues).toHaveLength(1);
		const issue = payload.issues[0]!;
		const sorted = [...paths].sort();
		expect(issue.relatedPaths).toEqual(sorted);
		expect(typeof issue.evidence.paths).toBe("string");
		expect(issue.evidence.paths).toBe(sorted.join(", "));
		expect(Object.keys(issue.evidence).sort()).toEqual([
			"count", "hashState", "mtimes", "paths", "referenceCounts", "referencedPaths",
		]);
		expect(issue.fingerprint).toBe(generateFingerprint("duplicate-files", undefined, { paths: sorted.join(",") }));
		expect(issue.fixAction).toMatchObject({ targetPaths: sorted.filter((path) => path !== paths[0]), selection: { candidatePaths: sorted, automaticKeepPath: paths[0] } });
		expect(issue.evidence.referenceCounts).toBe(sorted.map((path) => path === paths[0] ? 2 : 1).join(","));
		expect(issue.impact).toMatchObject({ filesTrashed: paths.length - 1, inboundReferences: paths.length - 1, coverageComplete: true });
		return issue;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
