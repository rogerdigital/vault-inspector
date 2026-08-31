import type { App } from "obsidian";
import type { InspectorSettings } from "../settings/settings";
import type {
	ScanProgress,
	ScanProgressCallback,
	ScanResult,
} from "./Issue";
import { compareScanResult, type LifecycleComparison } from "./result-diff";
import {
	appendScanHistoryEntry,
	createScanHistoryEntry,
	type ScanHistoryEntry,
	type ScanTrigger,
} from "../snapshot/scan-history";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";

/**
 * Headless-capable scan session. All view interaction is expressed as
 * optional hooks; all plugin state is injected as functions so persistence
 * ownership stays with the caller.
 */
export type ScanDeps = {
	app: App;
	runner: {
		run: (
			app: App,
			settings: InspectorSettings,
			options?: { onProgress?: ScanProgressCallback },
		) => Promise<ScanResult>;
	};
	createProfile: (settings: InspectorSettings) => Promise<string>;
	toolVersion: string;
	getSnapshot: () => ScanSnapshot | null;
	getHistory: () => ScanHistoryEntry[];
	persistAccepted: (accepted: {
		acceptedSnapshot: ScanSnapshot;
		acceptedHistory: ScanHistoryEntry[];
	}) => Promise<void>;
};

export type ScanSessionHooks = {
	onScanningChange?: (scanning: boolean) => void;
	onProgress?: (progress: ScanProgress) => void;
	onResult?: (result: ScanResult, comparison: LifecycleComparison) => void;
};

export type ScanSessionOutcome =
	| {
		status: "completed";
		result: ScanResult;
		comparison: LifecycleComparison;
		persistWarning?: string;
	}
	| { status: "failed"; message: string };

export type ScanOperationOutcome =
	| { status: "completed"; result: ScanResult }
	| { status: "failed"; message: string };

/**
 * Full scan session: clone settings, create the scan profile, run one scan,
 * then compare, accept, and persist successful results. Profile failures
 * fire no hooks; scanning failures and acceptance failures clean up the
 * scanning state best-effort. Never throws.
 */
export async function runScanSession(
	deps: ScanDeps,
	settings: InspectorSettings,
	hooks: ScanSessionHooks = {},
	trigger: ScanTrigger = "manual",
): Promise<ScanSessionOutcome> {
	let scanSettings: InspectorSettings;
	let scanProfile: string;
	try {
		scanSettings = structuredClone(settings);
		scanProfile = await deps.createProfile(scanSettings);
	} catch (error) {
		return { status: "failed", message: errorMessage(error) };
	}

	const operation = await runScanOperation(deps, scanSettings, hooks);
	if (operation.status === "failed") return operation;

	try {
		const accepted = await acceptScanResult(
			deps,
			hooks,
			operation.result,
			scanProfile,
			trigger,
		);
		return { status: "completed", result: operation.result, ...accepted };
	} catch (error) {
		stopScanningBestEffort(hooks);
		return { status: "failed", message: errorMessage(error) };
	}
}

/**
 * Scan-only operation for the verified fix pipeline. The caller owns settings
 * freezing and profile creation; the given settings are passed through
 * uncloned and no acceptance happens here. Never throws.
 */
export async function runScanOperation(
	deps: ScanDeps,
	settings: InspectorSettings,
	hooks: ScanSessionHooks = {},
): Promise<ScanOperationOutcome> {
	try {
		hooks.onScanningChange?.(true);
		const result = await deps.runner.run(deps.app, settings, {
			onProgress: (progress) => {
				try {
					hooks.onProgress?.(progress);
				} catch {
					// A failed progress consumer must not fail the scan.
				}
			},
		});
		return { status: "completed", result };
	} catch (error) {
		stopScanningBestEffort(hooks);
		return { status: "failed", message: errorMessage(error) };
	}
}

/**
 * Compares, displays (via the optional onResult hook), and persists one
 * successful result. onResult errors propagate (an undisplayable result is
 * an acceptance failure); persistence errors are returned as persistWarning.
 */
export async function acceptScanResult(
	deps: ScanDeps,
	hooks: ScanSessionHooks,
	result: ScanResult,
	scanProfile: string,
	trigger: ScanTrigger = "manual",
): Promise<{ comparison: LifecycleComparison; persistWarning?: string }> {
	const comparison = compareScanResult(result, deps.getSnapshot(), scanProfile);
	hooks.onResult?.(result, comparison);

	const nextSnapshot = createScanSnapshot(result, scanProfile, deps.toolVersion);
	const nextHistory = appendScanHistoryEntry(
		deps.getHistory(),
		createScanHistoryEntry({
			result,
			comparison,
			scanProfile,
			toolVersion: deps.toolVersion,
			trigger,
		}),
	);
	try {
		await deps.persistAccepted({
			acceptedSnapshot: nextSnapshot,
			acceptedHistory: nextHistory,
		});
	} catch (error) {
		return { comparison, persistWarning: errorMessage(error) };
	}
	return { comparison };
}

function stopScanningBestEffort(hooks: ScanSessionHooks): void {
	try {
		hooks.onScanningChange?.(false);
	} catch {
		// Preserve the original scan outcome when view cleanup is unavailable.
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
