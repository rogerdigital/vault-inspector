import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ScanRunner } from "../scanner/ScanRunner";
import type { ScanProgress, ScanResult, ScannerId } from "../scanner/Issue";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";
import { registerDefaultScanners } from "../scanner/register-scanners";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../settings/settings";
import { generateMarkdownReport } from "../report/markdown-export";
import { createLocalApp } from "./local-vault";
import { TOOL_VERSION } from "./version";
import { formatDuration } from "../utils/format";

type OutputFormat = "json" | "markdown";
type FailOn = "any" | "error" | "warning" | "new" | "none";
type Severity = "error" | "warning" | "info";

type CliOptions = {
	command: "scan";
	vaultPath: string;
	format: OutputFormat;
	outputPath?: string;
	scanners?: ScannerId[];
	severity?: Severity[];
	include: string[];
	exclude: string[];
	ignoredFolders: string[];
	baselinePath?: string;
	failOn: FailOn;
	fix: boolean;
	progress: boolean;
	largeMarkdownBytes?: number;
	largeAttachmentBytes?: number;
	duplicateHashMaxBytes?: number;
	lowUsageTagThreshold?: number;
	emptyNoteWordThreshold?: number;
	watchedTags?: string[];
	ignoredProperties?: string[];
};

type ParsedArgs = CliOptions & { configPath?: string };

type CliRuntime = {
	writeStderr?: (text: string) => void;
};

export type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export async function runCli(args: string[], runtime: CliRuntime = {}): Promise<CliResult> {
	let stderr = "";
	const writeStderr = (text: string) => {
		if (runtime.writeStderr) {
			runtime.writeStderr(text);
		} else {
			stderr += text;
		}
	};

	const parsedArgs = parseArgs(args);
	if ("error" in parsedArgs) {
		return { exitCode: 2, stdout: "", stderr: `${parsedArgs.error}\n` };
	}

	const parsed = await loadConfig(parsedArgs);
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
		if (parsed.progress) writeStderr("Scanning vault...\n");
		const scanStartedAt = Date.now();
		const scanResult = await scanRunner.run(app, makeSettings(parsed), {
			onProgress: parsed.progress
				? (progress) => writeStderr(formatProgressLine(progress))
				: undefined,
		});
		const baselineFingerprints = parsed.baselinePath
			? await readBaselineFingerprints(parsed.baselinePath)
			: new Set<string>();
		const result = applyOutputFilters(scanResult, parsed, baselineFingerprints);
		const output = formatResult(result, vaultPath, parsed.format);
		const exitCode = getExitCode(result, parsed.failOn);

		if (parsed.outputPath) {
			await writeFile(parsed.outputPath, output, "utf8");
			if (parsed.progress) writeStderr(`Done in ${formatDuration(Date.now() - scanStartedAt)}\n`);
			return { exitCode, stdout: "", stderr };
		}

		if (parsed.progress) writeStderr(`Done in ${formatDuration(Date.now() - scanStartedAt)}\n`);
		return {
			exitCode,
			stdout: `${output}\n`,
			stderr,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeStderr(`Scan failed: ${message}\n`);
		return { exitCode: 2, stdout: "", stderr };
	}
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
	const hasScanCommand = args[0] === "scan";
	if (args[0]?.startsWith("-")) {
		return { error: usage("Missing vault path") };
	}

	const vaultPath = hasScanCommand ? args[1] : args[0];
	if (!vaultPath || vaultPath.startsWith("-")) {
		return { error: usage("Missing vault path") };
	}

	const options: ParsedArgs = {
		command: "scan",
		vaultPath,
		format: "json",
		include: [],
		exclude: [],
		ignoredFolders: [],
		failOn: "any",
		fix: false,
		progress: false,
	};

	for (let index = hasScanCommand ? 2 : 1; index < args.length; index++) {
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
			const scanners = parseList(value);
			const validation = validateScanners(scanners);
			if (validation) return { error: usage(validation) };
			options.scanners = scanners as ScannerId[];
		} else if (arg === "--severity") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --severity value") };
			const severity = parseList(value);
			const invalid = severity.find((item) => !isSeverity(item));
			if (invalid) return { error: usage(`Unknown severity: ${invalid}`) };
			options.severity = severity as Severity[];
		} else if (arg === "--include") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --include value") };
			options.include.push(value);
		} else if (arg === "--exclude") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --exclude value") };
			options.exclude.push(value);
		} else if (arg === "--ignore-folder") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --ignore-folder value") };
			options.ignoredFolders.push(value);
		} else if (arg === "--config") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --config value") };
			options.configPath = value;
		} else if (arg === "--baseline") {
			const value = args[++index];
			if (!value) return { error: usage("Missing --baseline value") };
			options.baselinePath = value;
		} else if (arg === "--fail-on") {
			const value = args[++index];
			if (!isFailOn(value)) return { error: usage(`Unsupported --fail-on value: ${value ?? ""}`) };
			options.failOn = value;
		} else if (arg === "--progress") {
			options.progress = true;
		} else if (arg === "--fix") {
			options.fix = true;
		} else {
			return { error: usage(`Unknown option: ${arg}`) };
		}
	}

	return options;
}

type CliConfig = Partial<
	Pick<
		CliOptions,
		| "scanners"
		| "severity"
		| "include"
		| "exclude"
		| "ignoredFolders"
		| "baselinePath"
		| "failOn"
		| "largeMarkdownBytes"
		| "largeAttachmentBytes"
		| "duplicateHashMaxBytes"
		| "lowUsageTagThreshold"
		| "emptyNoteWordThreshold"
		| "watchedTags"
		| "ignoredProperties"
	>
>;

async function loadConfig(args: ParsedArgs): Promise<CliOptions | { error: string }> {
	if (!args.configPath) return args;
	try {
		const raw = await readFile(args.configPath, "utf8");
		const config = JSON.parse(raw) as CliConfig;
		const validationError = validateConfig(config);
		if (validationError) return { error: validationError };

		return {
			...args,
			scanners: args.scanners ?? config.scanners,
			severity: args.severity ?? config.severity,
			include: args.include.length > 0 ? args.include : config.include ?? [],
			exclude: args.exclude.length > 0 ? args.exclude : config.exclude ?? [],
			ignoredFolders:
				args.ignoredFolders.length > 0
					? args.ignoredFolders
					: config.ignoredFolders ?? [],
			baselinePath: args.baselinePath ?? config.baselinePath,
			failOn: args.failOn !== "any" ? args.failOn : config.failOn ?? args.failOn,
			largeMarkdownBytes: args.largeMarkdownBytes ?? config.largeMarkdownBytes,
			largeAttachmentBytes: args.largeAttachmentBytes ?? config.largeAttachmentBytes,
			duplicateHashMaxBytes: args.duplicateHashMaxBytes ?? config.duplicateHashMaxBytes,
			lowUsageTagThreshold: args.lowUsageTagThreshold ?? config.lowUsageTagThreshold,
			emptyNoteWordThreshold:
				args.emptyNoteWordThreshold ?? config.emptyNoteWordThreshold,
			watchedTags: args.watchedTags ?? config.watchedTags,
			ignoredProperties: args.ignoredProperties ?? config.ignoredProperties,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `Could not read config: ${message}` };
	}
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
		largeMarkdownBytes: options.largeMarkdownBytes ?? DEFAULT_SETTINGS.largeMarkdownBytes,
		largeAttachmentBytes:
			options.largeAttachmentBytes ?? DEFAULT_SETTINGS.largeAttachmentBytes,
		duplicateHashMaxBytes:
			options.duplicateHashMaxBytes ?? DEFAULT_SETTINGS.duplicateHashMaxBytes,
		lowUsageTagThreshold:
			options.lowUsageTagThreshold ?? DEFAULT_SETTINGS.lowUsageTagThreshold,
		emptyNoteWordThreshold:
			options.emptyNoteWordThreshold ?? DEFAULT_SETTINGS.emptyNoteWordThreshold,
		watchedTags: options.watchedTags ?? DEFAULT_SETTINGS.watchedTags,
		ignoredFolders: options.ignoredFolders,
		ignoredProperties: options.ignoredProperties ?? DEFAULT_SETTINGS.ignoredProperties,
	};
}

function formatResult(
	result: CliScanResult,
	vaultPath: string,
	format: OutputFormat,
): string {
	if (format === "markdown") return generateMarkdownReport(result);
	return JSON.stringify(toJsonPayload(result, vaultPath), null, 2);
}

function formatProgressLine(progress: ScanProgress): string {
	const label = SCANNER_LABELS[progress.scannerId];
	if (progress.type === "scanner-skipped") {
		return `[${progress.scannerIndex}/${progress.scannerTotal}] ${label} skipped (${progress.message ?? "disabled"})\n`;
	}
	if (progress.type === "scanner-start") {
		return `[${progress.scannerIndex}/${progress.scannerTotal}] ${label}\n`;
	}
	if (progress.type === "scanner-complete") return "";

	const detail = formatProgressDetail(progress);
	return detail ? `  ${detail}\n` : "";
}

function formatProgressDetail(progress: ScanProgress): string {
	const parts: string[] = [];
	if (progress.phase) {
		if (typeof progress.current === "number" && typeof progress.total === "number") {
			parts.push(`${progress.phase}: ${progress.current}/${progress.total}`);
		} else {
			parts.push(progress.phase);
		}
	}
	if (progress.message) parts.push(progress.message);
	return parts.join(", ");
}

function toJsonPayload(result: CliScanResult, vaultPath: string): Record<string, unknown> {
	const errors = result.issues.filter((issue) => issue.severity === "error").length;
	const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
	const info = result.issues.filter((issue) => issue.severity === "info").length;
	const newIssues = result.issues.filter((issue) => issue.isNew !== false).length;

	return {
		schemaVersion: 1,
		tool: "vault-inspector",
		toolVersion: TOOL_VERSION,
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
			newIssues,
			durationMs: result.finishedAt - result.startedAt,
		},
		issues: result.issues,
		ignoredIssues: result.ignoredIssues,
	};
}

type CliIssue = ScanResult["issues"][number] & { isNew?: boolean };
type CliScanResult = Omit<ScanResult, "issues" | "ignoredIssues"> & {
	issues: CliIssue[];
	ignoredIssues: CliIssue[];
};

function applyOutputFilters(
	result: ScanResult,
	options: CliOptions,
	baselineFingerprints: Set<string>,
): CliScanResult {
	const filterIssue = (issue: ScanResult["issues"][number]) => {
		if (options.severity && !options.severity.includes(issue.severity)) return false;
		const path = issue.primaryPath ?? issue.relatedPaths[0] ?? "";
		if (options.include.length > 0 && !options.include.some((glob) => matchesGlob(path, glob))) {
			return false;
		}
		if (options.exclude.some((glob) => matchesGlob(path, glob))) return false;
		return true;
	};

	const annotate = (issue: ScanResult["issues"][number]): CliIssue => ({
		...issue,
		isNew: baselineFingerprints.size === 0
			? true
			: !baselineFingerprints.has(issue.fingerprint),
	});

	return {
		...result,
		issues: result.issues.filter(filterIssue).map(annotate),
		ignoredIssues: result.ignoredIssues.filter(filterIssue).map(annotate),
	};
}

async function readBaselineFingerprints(path: string): Promise<Set<string>> {
	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as { issues?: Array<{ fingerprint?: unknown }> };
	return new Set(
		(parsed.issues ?? [])
			.map((issue) => issue.fingerprint)
			.filter((fingerprint): fingerprint is string => typeof fingerprint === "string"),
	);
}

function getExitCode(result: CliScanResult, failOn: FailOn): number {
	if (failOn === "none") return 0;
	if (failOn === "new") return result.issues.some((issue) => issue.isNew !== false) ? 1 : 0;
	if (failOn === "error") return result.issues.some((issue) => issue.severity === "error") ? 1 : 0;
	if (failOn === "warning") {
		return result.issues.some((issue) => issue.severity === "error" || issue.severity === "warning")
			? 1
			: 0;
	}
	return result.issues.length > 0 ? 1 : 0;
}

function validateConfig(config: CliConfig): string | null {
	if (config.scanners) {
		const validation = validateScanners(config.scanners);
		if (validation) return validation;
	}
	if (config.severity) {
		const invalid = config.severity.find((item) => !isSeverity(item));
		if (invalid) return `Unknown severity: ${invalid}`;
	}
	if (config.failOn && !isFailOn(config.failOn)) {
		return `Unsupported failOn value: ${config.failOn}`;
	}
	return null;
}

function validateScanners(scanners: string[]): string | null {
	const invalid = scanners.find((scanner) => !SCANNER_IDS.includes(scanner as ScannerId));
	return invalid ? `Unknown scanner: ${invalid}` : null;
}

function parseList(value: string): string[] {
	return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isSeverity(value: unknown): value is Severity {
	return value === "error" || value === "warning" || value === "info";
}

function isFailOn(value: unknown): value is FailOn {
	return value === "any" || value === "error" || value === "warning" || value === "new" || value === "none";
}

function matchesGlob(path: string, glob: string): boolean {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\u0000")
		.replace(/\*/g, "[^/]*")
		.replace(/\u0000/g, ".*");
	return new RegExp(`^${escaped}$`).test(path);
}

function usage(message: string): string {
	return `${message}

Usage:
  vinspect <vault-path> [--format json|markdown] [--output <path>]
  vault-inspector <vault-path> [--format json|markdown] [--output <path>]
  vault-inspector scan <vault-path> [--format json|markdown] [--output <path>]

Options:
  --scanner <id[,id]>       Run only selected scanners.
  --severity <level[,level]> Include only selected severities.
  --include <glob>          Include matching issue paths. Can be repeated.
  --exclude <glob>          Exclude matching issue paths. Can be repeated.
  --ignore-folder <path>    Ignore a vault-relative folder. Can be repeated.
  --config <path>           Load CLI options from a JSON config file.
  --baseline <path>         Compare issue fingerprints against a previous JSON report.
  --fail-on <mode>          any, error, warning, new, or none.
  --progress                Write scan progress to stderr.
  --fix                     Reserved for future opt-in fix execution.
`;
}
