import type { InspectorSettings } from "../settings/settings";
import type { Issue, ScanResult } from "./Issue";
import type { LifecycleComparison } from "./result-diff";
import type { ScanSessionOutcome } from "./scan-session";
import type { ScanSnapshot } from "../snapshot/scan-snapshot";

const HOUR_MS = 3_600_000;

export type AutomaticScanDecision =
	| { run: true }
	| { run: false; reason: "disabled" | "fresh" | "busy" };

/**
 * Complete gating policy for the startup check: interval <= 0 disables,
 * an active scan or mutation batch skips, a last successful scan inside
 * the interval is fresh, and a missing snapshot counts as stale.
 */
export function decideAutomaticScan(input: {
	settings: InspectorSettings;
	snapshot: ScanSnapshot | null;
	now: number;
	busy: boolean;
}): AutomaticScanDecision {
	const intervalMs = input.settings.automaticScanIntervalHours * HOUR_MS;
	if (intervalMs <= 0) return { run: false, reason: "disabled" };
	if (input.busy) return { run: false, reason: "busy" };
	if (
		input.snapshot !== null
		&& input.now - input.snapshot.createdAt < intervalMs
	) {
		return { run: false, reason: "fresh" };
	}
	return { run: true };
}

/**
 * Clones the settings for one automatic scan and excludes the
 * external-link scanner unless network checks are separately enabled.
 * The exclusion is expressed through enabledScanners so the effective
 * scanner set stays part of the detection profile.
 */
export function automaticScanSettings(
	settings: InspectorSettings,
): InspectorSettings {
	const scanSettings = structuredClone(settings);
	if (!scanSettings.automaticScanNetworkChecks) {
		scanSettings.enabledScanners["external-links"] = false;
	}
	return scanSettings;
}

/**
 * Active, non-ignored findings that are newly detected, confirmed, and
 * errors. Anything else — persisting, candidate, unverified, warning or
 * info severity, ignored, or compared against an unavailable baseline —
 * is not worth a notice.
 */
export function confirmedNewIssues(
	result: ScanResult,
	comparison: LifecycleComparison,
): Issue[] {
	if (!comparison.available) return [];
	return result.issues.filter((issue) =>
		comparison.statuses.get(issue.fingerprint) === "new"
		&& issue.classification === "confirmed"
		&& issue.severity === "error");
}

export function automaticScanNotice(newIssues: Issue[]): string {
	const count = newIssues.length;
	return `Vault Inspector automatic scan found ${count} new confirmed error${count === 1 ? "" : "s"}.`;
}

export type StartupScanSchedulerDeps = {
	getSettings: () => InspectorSettings;
	getSnapshot: () => ScanSnapshot | null;
	isBusy: () => boolean;
	now: () => number;
	whenSettled: (run: () => void) => void;
	runAutomaticScan: (settings: InspectorSettings) => Promise<ScanSessionOutcome>;
	notify: (message: string) => void;
};

export type StartupScanScheduler = { schedule: () => void };

/**
 * One-shot startup trigger. schedule() registers at most one settle
 * callback per activation, and the fired guard keeps the check itself to
 * at most one run even if the settle signal is delivered twice. Skips
 * stay silent; only a completed scan with new confirmed errors notifies.
 */
export function createStartupScanScheduler(
	deps: StartupScanSchedulerDeps,
): StartupScanScheduler {
	let scheduled = false;
	let fired = false;
	return {
		schedule() {
			if (scheduled) return;
			scheduled = true;
			deps.whenSettled(() => {
				if (fired) return;
				fired = true;
				const decision = decideAutomaticScan({
					settings: deps.getSettings(),
					snapshot: deps.getSnapshot(),
					now: deps.now(),
					busy: deps.isBusy(),
				});
				if (!decision.run) return;
				void deps
					.runAutomaticScan(automaticScanSettings(deps.getSettings()))
					.then((outcome) => {
						if (outcome.status !== "completed" || outcome.persistWarning !== undefined) return;
						const newIssues = confirmedNewIssues(
							outcome.result,
							outcome.comparison,
						);
						if (newIssues.length > 0) {
							deps.notify(automaticScanNotice(newIssues));
						}
					})
					.catch(() => {
						// Automatic scans are best-effort; failures stay silent.
					});
			});
		},
	};
}
