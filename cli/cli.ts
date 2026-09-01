import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ScanRunner } from "../src/scanner/ScanRunner";
import type { ScanProgress, ScanResult, ScannerId } from "../src/scanner/Issue";
import { SCANNER_IDS, SCANNER_LABELS } from "../src/scanner/Issue";
import { registerDefaultScanners } from "../src/scanner/register-scanners";
import {
	createEmptyIgnoredFoldersByScanner,
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "../src/settings/settings";
import { generateMarkdownReport } from "../src/report/markdown-export";
import { createLocalApp } from "./local-vault";
import { TOOL_VERSION } from "./version";
import { formatDuration } from "../src/utils/format";
import { matchesGlob } from "../src/utils/paths";
import { requestPublicHttpStatus } from "./public-http";
import type { ExternalRequestAdapter } from "../src/scanner/ScanContext";
import { createScanProfile } from "../src/scanner/scan-profile";
import { COMPARISON_VERSION } from "../src/snapshot/scan-snapshot";
import {
	resolveBaselineCompatibility,
	type BaselineMismatchReason,
} from "../src/scanner/result-diff";

type OutputFormat = "json" | "markdown";
type FailOn = "any" | "error" | "warning" | "new" | "none";
type Severity = "error" | "warning" | "info";

export type CliComparisonMode = "profile" | "legacy" | "none";
export type CliComparisonReason =
	| "missing-baseline"
	| "settings-changed"
	| "semantics-changed";

/**
 * Additive top-level comparison metadata for CLI JSON output. `available`
 * mirrors the plugin's LifecycleComparison semantics: whether the
 * new/persisting/resolved counts are trustworthy lifecycle claims. Counts
 * cover the full unfiltered result (issues + ignoredIssues), so they can
 * differ from the filtered `summary.newIssues`. `mode: "profile"` and the
 * settings/semantics reasons are reserved for compatibility-aware baseline
 * reading (roadmap Task 4.2); 4.1 baselines are fingerprint-only
 * ("legacy").
 */
export type CliComparison = {
	available: boolean;
	mode: CliComparisonMode;
	reason?: CliComparisonReason;
	newIssues: number;
	persistingIssues: number;
	resolvedIssues: number;
	scanProfile: string;
	comparisonVersion: number;
};

/**
 * A parsed --baseline file. "current" baselines carry well-formed
 * comparison.scanProfile/comparisonVersion metadata (written by the CLI
 * since Task 4.1) and include ignoredIssues fingerprints, mirroring
 * createScanSnapshot. "legacy" baselines are pre-4.1 reports without the
 * comparison object; their fingerprint extraction is frozen to `issues`.
 */
export type BaselineReport =
	| {
			kind: "current";
			fingerprints: Set<string>;
			scanProfile: string;
			comparisonVersion: number;
		}
	| { kind: "legacy"; fingerprints: Set<string> };

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
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
	ignoreUnresolvedNoteLinks: boolean;
	baselinePath?: string;
	failOn: FailOn;
	fix: boolean;
	progress: boolean;
	largeMarkdownBytes?: number;
	largeAttachmentBytes?: number;
	ignoredLargeMarkdownFrontmatterKeys?: string[];
	ignoredLargeMarkdownPathPatterns?: string[];
	duplicateHashMaxBytes?: number;
	lowUsageTagThreshold?: number;
	emptyNoteWordThreshold?: number;
	watchedTags?: string[];
	ignoredProperties?: string[];
};

type ParsedArgs = CliOptions & { configPath?: string };

type CliRuntime = {
	writeStderr?: (text: string) => void;
	requestUrl?: ExternalRequestAdapter;
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

	if (args[0] === "--help" || args[0] === "-h") {
		return { exitCode: 0, stdout: `${usageText()}\n`, stderr: "" };
	}

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
		const scanRunner = new ScanRunner(
			runtime.requestUrl
				?? ((url, method, signal) => requestPublicHttpStatus(url, signal)),
			{
				setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
				clearTimeout: (timeoutId) => clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
			},
		);
		registerDefaultScanners(scanRunner);
		const app = await createLocalApp(vaultPath);
		if (parsed.progress) writeStderr("Scanning vault...\n");
		const scanStartedAt = Date.now();
		const scanSettings = makeSettings(parsed);
		const scanProfile = await createScanProfile(scanSettings);
		const scanResult = await scanRunner.run(app, scanSettings, {
			onProgress: parsed.progress
				? (progress) => writeStderr(formatProgressLine(progress))
				: undefined,
		});
		const baseline = parsed.baselinePath
			? await readBaseline(parsed.baselinePath)
			: null;
		const mismatch = baseline?.kind === "current"
			? resolveBaselineCompatibility(
					baseline.comparisonVersion,
					baseline.scanProfile,
					scanProfile,
				)
			: null;
		if (baseline?.kind === "legacy") {
			writeStderr(
				`Baseline ${parsed.baselinePath} has no scan profile metadata; comparing fingerprints only (legacy mode). Regenerate the baseline to enable profile-aware comparison.\n`,
			);
		}
		if (mismatch) {
			writeStderr(
				`Baseline is not comparable (reason: ${mismatch}). Regenerate the baseline or rerun without --baseline.\n`,
			);
		}
		const comparison = buildCliComparison(scanResult, baseline, scanProfile, mismatch);
		const result = applyOutputFilters(
			scanResult,
			parsed,
			mismatch ? null : baseline ? baseline.fingerprints : new Set<string>(),
		);
		const output = formatResult(result, vaultPath, parsed.format, comparison);
		const exitCode = mismatch ? 2 : getExitCode(result, parsed.failOn);

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
		ignoredFoldersByScanner: createEmptyIgnoredFoldersByScanner(),
		ignoreUnresolvedNoteLinks: false,
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
		} else if (arg === "--ignore-unresolved-note-links") {
			options.ignoreUnresolvedNoteLinks = true;
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
		| "ignoreUnresolvedNoteLinks"
		| "baselinePath"
		| "failOn"
		| "largeMarkdownBytes"
		| "largeAttachmentBytes"
		| "ignoredLargeMarkdownFrontmatterKeys"
		| "ignoredLargeMarkdownPathPatterns"
		| "duplicateHashMaxBytes"
		| "lowUsageTagThreshold"
		| "emptyNoteWordThreshold"
		| "watchedTags"
		| "ignoredProperties"
	>
> & {
	ignoredFoldersByScanner?: Partial<Record<ScannerId, string[]>>;
};

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
			ignoredFoldersByScanner: config.ignoredFoldersByScanner
				? { ...args.ignoredFoldersByScanner, ...config.ignoredFoldersByScanner }
				: args.ignoredFoldersByScanner,
			ignoreUnresolvedNoteLinks:
				args.ignoreUnresolvedNoteLinks ||
				(config.ignoreUnresolvedNoteLinks ?? false),
			baselinePath: args.baselinePath ?? config.baselinePath,
			failOn: args.failOn !== "any" ? args.failOn : config.failOn ?? args.failOn,
			largeMarkdownBytes: args.largeMarkdownBytes ?? config.largeMarkdownBytes,
			largeAttachmentBytes: args.largeAttachmentBytes ?? config.largeAttachmentBytes,
			ignoredLargeMarkdownFrontmatterKeys:
				args.ignoredLargeMarkdownFrontmatterKeys ??
				config.ignoredLargeMarkdownFrontmatterKeys,
			ignoredLargeMarkdownPathPatterns:
				args.ignoredLargeMarkdownPathPatterns ??
				config.ignoredLargeMarkdownPathPatterns,
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
		ignoredLargeMarkdownFrontmatterKeys:
			options.ignoredLargeMarkdownFrontmatterKeys ??
			DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys,
		ignoredLargeMarkdownPathPatterns:
			options.ignoredLargeMarkdownPathPatterns ??
			DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns,
		duplicateHashMaxBytes:
			options.duplicateHashMaxBytes ?? DEFAULT_SETTINGS.duplicateHashMaxBytes,
		lowUsageTagThreshold:
			options.lowUsageTagThreshold ?? DEFAULT_SETTINGS.lowUsageTagThreshold,
		emptyNoteWordThreshold:
			options.emptyNoteWordThreshold ?? DEFAULT_SETTINGS.emptyNoteWordThreshold,
		watchedTags: options.watchedTags ?? DEFAULT_SETTINGS.watchedTags,
		ignoredFolders: options.ignoredFolders,
		ignoredFoldersByScanner: options.ignoredFoldersByScanner,
		ignoreUnresolvedNoteLinks: options.ignoreUnresolvedNoteLinks,
		ignoredProperties: options.ignoredProperties ?? DEFAULT_SETTINGS.ignoredProperties,
	};
}

function formatResult(
	result: CliScanResult,
	vaultPath: string,
	format: OutputFormat,
	comparison: CliComparison,
): string {
	if (format === "markdown") return generateMarkdownReport(result);
	return JSON.stringify(toJsonPayload(result, vaultPath, comparison), null, 2);
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

function toJsonPayload(
	result: CliScanResult,
	vaultPath: string,
	comparison: CliComparison,
): Record<string, unknown> {
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
		comparison,
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
	baselineFingerprints: Set<string> | null,
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

	// null means the baseline is not comparable: no isNew annotation is
	// fabricated from an incompatible baseline.
	const annotate = (issue: ScanResult["issues"][number]): CliIssue =>
		baselineFingerprints === null
			? issue
			: {
					...issue,
					isNew: baselineFingerprints.size === 0
						? true
						: !baselineFingerprints.has(issue.fingerprint),
				};

	return {
		...result,
		issues: result.issues.filter(filterIssue).map(annotate),
		ignoredIssues: result.ignoredIssues.filter(filterIssue).map(annotate),
	};
}

async function readBaseline(path: string): Promise<BaselineReport> {
	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as {
		issues?: Array<{ fingerprint?: unknown }>;
		ignoredIssues?: Array<{ fingerprint?: unknown }>;
		comparison?: unknown;
	};

	const readFingerprints = (
		issues: Array<{ fingerprint?: unknown }> | undefined,
	): string[] =>
		(issues ?? [])
			.map((issue) => issue.fingerprint)
			.filter((fingerprint): fingerprint is string => typeof fingerprint === "string");

	if (parsed.comparison === undefined) {
		return { kind: "legacy", fingerprints: new Set(readFingerprints(parsed.issues)) };
	}

	if (!isBaselineComparisonMetadata(parsed.comparison)) {
		throw new Error("Invalid baseline: comparison metadata is malformed");
	}

	return {
		kind: "current",
		fingerprints: new Set([
			...readFingerprints(parsed.issues),
			...readFingerprints(parsed.ignoredIssues),
		]),
		scanProfile: parsed.comparison.scanProfile,
		comparisonVersion: parsed.comparison.comparisonVersion,
	};
}

function isBaselineComparisonMetadata(
	value: unknown,
): value is { scanProfile: string; comparisonVersion: number } {
	if (typeof value !== "object" || value === null) return false;
	const record = value as { scanProfile?: unknown; comparisonVersion?: unknown };
	return (
		typeof record.scanProfile === "string" &&
		record.scanProfile !== "" &&
		typeof record.comparisonVersion === "number" &&
		Number.isSafeInteger(record.comparisonVersion) &&
		record.comparisonVersion > 0
	);
}

/**
 * Builds the additive comparison metadata for one CLI run. Without a
 * baseline the comparison is honestly unavailable (zero counts, never
 * "everything is new"). A current-format baseline that fails
 * resolveBaselineCompatibility is a setup failure: available is false, the
 * reason names the mismatch, and all counts are zero. Legacy baselines are
 * compared fingerprint-only ("legacy"); matched current baselines compare
 * under "profile". Counts always cover the FULL unfiltered result
 * (issues + ignoredIssues), mirroring compareScanResult in
 * src/scanner/result-diff.ts so output filters never inflate
 * resolvedIssues.
 */
function buildCliComparison(
	result: ScanResult,
	baseline: BaselineReport | null,
	scanProfile: string,
	mismatch: BaselineMismatchReason | null,
): CliComparison {
	const metadata = {
		scanProfile,
		comparisonVersion: COMPARISON_VERSION,
	};

	if (baseline === null) {
		return {
			available: false,
			mode: "none",
			reason: "missing-baseline",
			newIssues: 0,
			persistingIssues: 0,
			resolvedIssues: 0,
			...metadata,
		};
	}

	const currentFingerprints = new Set([
		...result.issues.map((issue) => issue.fingerprint),
		...result.ignoredIssues.map((issue) => issue.fingerprint),
	]);

	let newIssues = 0;
	let persistingIssues = 0;
	for (const fingerprint of currentFingerprints) {
		if (baseline.fingerprints.has(fingerprint)) {
			persistingIssues++;
		} else {
			newIssues++;
		}
	}

	let resolvedIssues = 0;
	for (const fingerprint of baseline.fingerprints) {
		if (!currentFingerprints.has(fingerprint)) resolvedIssues++;
	}

	if (mismatch) {
		return {
			available: false,
			mode: "profile",
			reason: mismatch,
			newIssues: 0,
			persistingIssues: 0,
			resolvedIssues: 0,
			...metadata,
		};
	}

	return {
		available: true,
		mode: baseline.kind === "current" ? "profile" : "legacy",
		newIssues,
		persistingIssues,
		resolvedIssues,
		...metadata,
	};
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
		if (invalid) return `Unknown severity: ${String(invalid)}`;
	}
	if (config.failOn && !isFailOn(config.failOn)) {
		return `Unsupported failOn value: ${String(config.failOn)}`;
	}
	if (
		config.ignoreUnresolvedNoteLinks !== undefined &&
		typeof config.ignoreUnresolvedNoteLinks !== "boolean"
	) {
		return "ignoreUnresolvedNoteLinks must be a boolean";
	}
	if (config.ignoredFoldersByScanner !== undefined) {
		if (
			typeof config.ignoredFoldersByScanner !== "object" ||
			config.ignoredFoldersByScanner === null ||
			Array.isArray(config.ignoredFoldersByScanner)
		) {
			return "ignoredFoldersByScanner must be an object of scanner IDs to folder arrays";
		}
		for (const [scannerId, folders] of Object.entries(config.ignoredFoldersByScanner)) {
			if (!SCANNER_IDS.includes(scannerId as ScannerId)) {
				return `Unknown scanner in ignoredFoldersByScanner: ${scannerId}`;
			}
			if (
				!Array.isArray(folders) ||
				folders.some((folder) => typeof folder !== "string")
			) {
				return `ignoredFoldersByScanner.${scannerId} must be an array of folder paths`;
			}
		}
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

function usage(message: string): string {
	return `${message}

${usageText()}`;
}

function usageText(): string {
	return `Usage:
  vinspect <vault-path> [--format json|markdown] [--output <path>]
  vault-inspector <vault-path> [--format json|markdown] [--output <path>]
  vault-inspector scan <vault-path> [--format json|markdown] [--output <path>]

Options:
  --scanner <id[,id]>       Run only selected scanners.
  --severity <level[,level]> Include only selected severities.
  --include <glob>          Include matching issue paths. Can be repeated.
  --exclude <glob>          Exclude matching issue paths. Can be repeated.
  --ignore-folder <path>    Ignore a vault-relative folder. Can be repeated.
  --ignore-unresolved-note-links
                            Ignore missing plain note wikilinks.
  --config <path>           Load CLI options from a JSON config file.
  --baseline <path>         Compare issue fingerprints against a previous JSON report.
  --fail-on <mode>          any, error, warning, new, or none.
  --progress                Write scan progress to stderr.
  --fix                     Reserved for future opt-in fix execution.
  --help                    Show this help message.`;
}
