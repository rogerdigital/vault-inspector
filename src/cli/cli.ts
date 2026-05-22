import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ScanRunner } from "../scanner/ScanRunner";
import type { ScanResult, ScannerId } from "../scanner/Issue";
import { SCANNER_IDS } from "../scanner/Issue";
import { registerDefaultScanners } from "../scanner/register-scanners";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../settings/settings";
import { generateMarkdownReport } from "../report/markdown-export";
import { createLocalApp } from "./local-vault";

type OutputFormat = "json" | "markdown";

type CliOptions = {
	command: "scan";
	vaultPath: string;
	format: OutputFormat;
	outputPath?: string;
	scanners?: ScannerId[];
	ignoredFolders: string[];
	fix: boolean;
};

export type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export async function runCli(args: string[]): Promise<CliResult> {
	const parsed = parseArgs(args);
	if ("error" in parsed) {
		return { exitCode: 2, stdout: "", stderr: `${parsed.error}\n` };
	}

	if (parsed.fix) {
		return {
			exitCode: 2,
			stdout: "",
			stderr:
				"CLI fix execution is not available yet. Run scans first; fix support will be added as an explicit opt-in command.\n",
		};
	}

	try {
		const vaultPath = resolve(parsed.vaultPath);
		const scanRunner = new ScanRunner();
		registerDefaultScanners(scanRunner);
		const app = await createLocalApp(vaultPath);
		const result = await scanRunner.run(app, makeSettings(parsed));
		const output = formatResult(result, vaultPath, parsed.format);

		if (parsed.outputPath) {
			await writeFile(parsed.outputPath, output, "utf8");
			return { exitCode: result.issues.length > 0 ? 1 : 0, stdout: "", stderr: "" };
		}

		return {
			exitCode: result.issues.length > 0 ? 1 : 0,
			stdout: `${output}\n`,
			stderr: "",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { exitCode: 2, stdout: "", stderr: `${message}\n` };
	}
}

function parseArgs(args: string[]): CliOptions | { error: string } {
	if (args[0] !== "scan") {
		return { error: usage("Expected command: scan") };
	}

	const vaultPath = args[1];
	if (!vaultPath || vaultPath.startsWith("-")) {
		return { error: usage("Missing vault path") };
	}

	const options: CliOptions = {
		command: "scan",
		vaultPath,
		format: "json",
		ignoredFolders: [],
		fix: false,
	};

	for (let index = 2; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--format") {
			const value = args[++index];
			if (value !== "json" && value !== "markdown") {
				return { error: usage(`Unsupported format: ${value ?? ""}`) };
			}
			options.format = value;
		} else if (arg === "--output") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --output value") };
			options.outputPath = value;
		} else if (arg === "--scanner") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --scanner value") };
			const scanners = value.split(",").map((item) => item.trim()).filter(Boolean);
			const invalid = scanners.find((scanner) => !SCANNER_IDS.includes(scanner as ScannerId));
			if (invalid) return { error: usage(`Unknown scanner: ${invalid}`) };
			options.scanners = scanners as ScannerId[];
		} else if (arg === "--ignore-folder") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --ignore-folder value") };
			options.ignoredFolders.push(value);
		} else if (arg === "--fix") {
			options.fix = true;
		} else {
			return { error: usage(`Unknown option: ${arg}`) };
		}
	}

	return options;
}

function makeSettings(options: CliOptions): InspectorSettings {
	const enabledScanners = { ...DEFAULT_SETTINGS.enabledScanners };
	if (options.scanners) {
		for (const id of SCANNER_IDS) enabledScanners[id] = false;
		for (const id of options.scanners) enabledScanners[id] = true;
	}

	return {
		...DEFAULT_SETTINGS,
		enabledScanners,
		enableFixActions: false,
		ignoredFolders: options.ignoredFolders,
	};
}

function formatResult(
	result: ScanResult,
	vaultPath: string,
	format: OutputFormat,
): string {
	if (format === "markdown") return generateMarkdownReport(result);
	return JSON.stringify(toJsonPayload(result, vaultPath), null, 2);
}

function toJsonPayload(result: ScanResult, vaultPath: string): Record<string, unknown> {
	const errors = result.issues.filter((issue) => issue.severity === "error").length;
	const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
	const info = result.issues.filter((issue) => issue.severity === "info").length;

	return {
		tool: "vault-inspector",
		vaultPath,
		generatedAt: new Date(result.finishedAt).toISOString(),
		summary: {
			filesScanned: result.filesScanned,
			scannersRun: result.scannersRun,
			issues: result.issues.length,
			ignoredIssues: result.ignoredIssues.length,
			errors,
			warnings,
			info,
			durationMs: result.finishedAt - result.startedAt,
		},
		issues: result.issues,
		ignoredIssues: result.ignoredIssues,
	};
}

function usage(message: string): string {
	return `${message}

Usage:
  vault-inspector scan <vault-path> [--format json|markdown] [--output <path>]

Options:
  --scanner <id[,id]>       Run only selected scanners.
  --ignore-folder <path>    Ignore a vault-relative folder. Can be repeated.
  --fix                     Reserved for future opt-in fix execution.
`;
}
