import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";

assert(process.argv[2], "Usage: node scripts/smoke-installed-cli.mjs <tarball>");
const tarball = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "vi-installed-"));
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };
const run = (file, args, cwd = root) => {
	const result = spawnSync(file, args, { cwd, env, encoding: "utf8" });
	if (result.error) throw result.error;
	return result;
};
try {
	const install = run("npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
	assert.equal(install.status, 0, install.stderr);
	const pkg = JSON.parse(await readFile(join(root, "node_modules/vault-inspector/package.json"), "utf8"));
	const vault = join(root, "vault");
	await mkdir(vault);
	const files = { "A.md": "Identical content", "B.md": "Identical content" };
	for (const [name, body] of Object.entries(files)) await writeFile(join(vault, name), body);
	for (const alias of ["vault-inspector", "vinspect"]) {
		const binary = join(root, "node_modules/.bin", alias);
		const help = run(binary, ["--help"]);
		assert.equal(help.status, 0, help.stderr);
		assert(help.stdout.includes("--config"));
		const scan = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files", "--fail-on", "none"]);
		assert.equal(scan.status, 0, scan.stderr);
		assert.equal(scan.stderr, "");
		const payload = JSON.parse(scan.stdout);
		assert.equal(payload.schemaVersion, 1);
		assert.equal(payload.toolVersion, pkg.version);
		assert.match(payload.comparison.scanProfile, /^[a-f0-9]{64}$/);
		assert(payload.issues.some((issue) => issue.scannerId === "duplicate-files" &&
			issue.evidence.hashState === "hash-confirmed" &&
			issue.relatedPaths.includes("A.md") && issue.relatedPaths.includes("B.md")));
		const baseline = join(root, `${alias}-baseline.json`);
		await writeFile(baseline, scan.stdout);
		const repeat = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files",
			"--baseline", baseline, "--fail-on", "new"]);
		assert.equal(repeat.status, 0, repeat.stderr);
		assert.equal(repeat.stderr, "");
		const comparison = JSON.parse(repeat.stdout).comparison;
		assert.equal(comparison.available, true);
		assert.equal(comparison.mode, "profile");
		assert.equal(comparison.newIssues, 0);
		assert.equal(comparison.resolvedIssues, 0);
		assert.equal(comparison.persistingIssues, payload.comparison.fingerprints.length);
		const old = structuredClone(payload);
		old.comparison.comparisonVersion -= 1;
		const oldBaseline = join(root, `${alias}-old-baseline.json`);
		await writeFile(oldBaseline, JSON.stringify(old));
		const mismatch = run(binary, [vault, "--format", "json", "--scanner", "duplicate-files",
			"--baseline", oldBaseline, "--fail-on", "none"]);
		assert.equal(mismatch.status, 2);
		assert.equal(JSON.parse(mismatch.stdout).comparison.reason, "semantics-changed");
		const failure = run(binary, ["scan", vault, "--scanner", "duplicate-files", "--fail-on", "any"]);
		assert.equal(failure.status, 1, failure.stderr);
		const config = join(root, "invalid.json");
		await writeFile(config, '{"largeMarkdownBytes":"garbage"}');
		const invalid = run(binary, [vault, "--config", config]);
		assert.equal(invalid.status, 2);
		assert.equal(invalid.stdout, "");
		assert.match(invalid.stderr, /largeMarkdownBytes must be a finite non-negative integer/);
	}
	for (const [name, body] of Object.entries(files)) assert.equal(await readFile(join(vault, name), "utf8"), body);
	assert.deepEqual((await readdir(vault)).sort(), Object.keys(files).sort());
	console.log(`Installed CLI smoke passed on ${process.version}`);
} finally {
	await rm(root, { recursive: true, force: true });
}
