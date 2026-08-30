#!/usr/bin/env node
// Deterministic, non-network scan benchmark for Vault Inspector.
//
// Bundles the TypeScript sources with the existing esbuild devDependency so a
// plain Node 18+ process can import them, generates a synthetic vault in a
// temp directory, and reports median scan timing plus read counters.
//
// Usage:
//   npm run benchmark:scan [-- --notes 400 --attachments 150 --runs 3 --json --keep]

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
	const options = { notes: 400, attachments: 150, runs: 3, json: false, keep: false };
	const rawValues = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--notes") { options.notes = Number(value); rawValues.notes = value; index++; }
		else if (flag === "--attachments") { options.attachments = Number(value); index++; }
		else if (flag === "--runs") { options.runs = Number(value); index++; }
		else if (flag === "--json") { options.json = true; }
		else if (flag === "--keep") { options.keep = true; }
		else {
			console.error(`Unknown argument: ${flag}`);
			process.exit(2);
		}
	}
	for (const key of ["notes", "attachments", "runs"]) {
		if (!Number.isInteger(options[key])) {
			console.error(`Invalid value for --${key}: expected an integer, got "${rawValues[key]}"`);
			process.exit(2);
		}
	}
	if (options.notes < 1) {
		console.error(`Invalid value for --notes: must be >= 1, got ${options.notes}`);
		process.exit(2);
	}
	if (options.attachments < 0) {
		console.error(`Invalid value for --attachments: must be >= 0, got ${options.attachments}`);
		process.exit(2);
	}
	if (options.runs < 1) {
		console.error(`Invalid value for --runs: must be >= 1, got ${options.runs}`);
		process.exit(2);
	}
	return options;
}

const ENTRY_SOURCE = `
export { createLocalApp } from "./cli/local-vault";
export { ScanRunner } from "./src/scanner/ScanRunner";
export { registerDefaultScanners } from "./src/scanner/register-scanners";
export { DEFAULT_SETTINGS } from "./src/settings/settings";
export { generateSyntheticVault } from "./src/tests/helpers/synthetic-vault";
`;

async function loadBundledExports() {
	const bundleDir = await mkdtemp(join(tmpdir(), "vault-inspector-benchmark-"));
	const bundlePath = join(bundleDir, "benchmark-bundle.mjs");
	await build({
		stdin: {
			contents: ENTRY_SOURCE,
			resolveDir: repoRoot,
			sourcefile: "benchmark-entry.ts",
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile: bundlePath,
		logLevel: "silent",
	});
	try {
		return await import(pathToFileURL(bundlePath).href);
	} finally {
		await rm(bundleDir, { recursive: true, force: true });
	}
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

const options = parseArgs(process.argv.slice(2));
const { createLocalApp, ScanRunner, registerDefaultScanners, DEFAULT_SETTINGS, generateSyntheticVault } =
	await loadBundledExports();

const vaultDir = await mkdtemp(join(tmpdir(), "vault-inspector-benchmark-vault-"));
try {
	const generated = await generateSyntheticVault(vaultDir, {
		notes: options.notes,
		attachments: options.attachments,
	});

	const scanDurations = [];
	const loadDurations = [];
	let lastResult = null;
	let hashReads = 0;
	let contentReads = 0;

	for (let run = 1; run <= options.runs; run++) {
		hashReads = 0;
		contentReads = 0;
		const loadStartedAt = performance.now();
		const app = await createLocalApp(vaultDir);
		const originalReadBinary = app.vault.readBinary.bind(app.vault);
		const originalCachedRead = app.vault.cachedRead.bind(app.vault);
		app.vault.readBinary = async (file) => {
			hashReads++;
			return originalReadBinary(file);
		};
		app.vault.cachedRead = async (file) => {
			contentReads++;
			return originalCachedRead(file);
		};
		loadDurations.push(performance.now() - loadStartedAt);

		const scanRunner = new ScanRunner();
		registerDefaultScanners(scanRunner);
		const settings = structuredClone(DEFAULT_SETTINGS);
		const scanStartedAt = performance.now();
		lastResult = await scanRunner.run(app, settings);
		scanDurations.push(performance.now() - scanStartedAt);
	}

	const issuesByScanner = {};
	for (const issue of lastResult.issues) {
		issuesByScanner[issue.scannerId] = (issuesByScanner[issue.scannerId] ?? 0) + 1;
	}
	const medianScanMs = Math.round(median(scanDurations));
	const medianLoadMs = Math.round(median(loadDurations));
	const summary =
		`benchmark:scan | ${lastResult.filesScanned} files | ${lastResult.issues.length} issues | ` +
		`${medianScanMs}ms median scan | ${hashReads} hash reads`;

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					files: lastResult.filesScanned,
					markdownFiles: generated.markdownFiles,
					attachmentFiles: generated.attachmentFiles,
					issues: lastResult.issues.length,
					issuesByScanner,
					runs: options.runs,
					scanMsPerRun: scanDurations.map((value) => Math.round(value)),
					medianScanMs,
					medianLoadMs,
					hashReads,
					contentReads,
					scannersRun: lastResult.scannersRun,
				},
				null,
				2,
			),
		);
	} else {
		console.log("vault-inspector scan benchmark");
		console.log(`  vault:            ${lastResult.filesScanned} files (${generated.markdownFiles} markdown, ${generated.attachmentFiles} attachments)`);
		console.log(`  scanners:         ${lastResult.scannersRun.length} (external-links disabled)`);
		console.log(`  runs:             ${options.runs}`);
		console.log(`  adapter load:     ${medianLoadMs} ms (median)`);
		console.log(`  scan:             ${medianScanMs} ms (median; runs: ${scanDurations.map((value) => Math.round(value)).join(", ")})`);
		console.log(`  issues:           ${lastResult.issues.length} total`);
		for (const [scannerId, count] of Object.entries(issuesByScanner).sort()) {
			console.log(`    ${scannerId.padEnd(20)} ${count}`);
		}
		console.log(`  files read for hashing: ${hashReads}`);
		console.log(`  content reads:          ${contentReads}`);
		console.log(summary);
	}
	if (options.keep) {
		console.error(`kept vault at ${vaultDir}`);
	} else {
		await rm(vaultDir, { recursive: true, force: true });
	}
} catch (error) {
	await rm(vaultDir, { recursive: true, force: true }).catch(() => {});
	throw error;
}
