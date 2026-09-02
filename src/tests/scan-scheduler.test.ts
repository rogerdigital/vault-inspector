import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "../settings/settings";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";
import type { ScanSessionOutcome } from "../scanner/scan-session";
import {
	automaticScanNotice,
	automaticScanSettings,
	confirmedNewIssues,
	createStartupScanScheduler,
	decideAutomaticScan,
	type StartupScanSchedulerDeps,
} from "../scanner/scan-scheduler";

const HOUR_MS = 3_600_000;

function makeSettings(
	mutate: (settings: InspectorSettings) => void = () => {},
): InspectorSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate(settings);
	return settings;
}

function makeIssue(
	fingerprint: string,
	classification: Issue["classification"] = "confirmed",
	severity: Issue["severity"] = "error",
): Issue {
	return {
		scannerId: "broken-links",
		severity,
		classification,
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		primaryPath: `${fingerprint}.md`,
		relatedPaths: [],
		evidence: { target: fingerprint },
		fingerprint,
	};
}

function makeResult(issues: Issue[], ignoredIssues: Issue[] = []): ScanResult {
	return {
		startedAt: 0,
		finishedAt: 1,
		issues,
		ignoredIssues,
		filesScanned: 1,
		scannersRun: ["broken-links", "empty-notes"],
	};
}

function makeSnapshot(createdAt: number): ScanSnapshot {
	return createScanSnapshot(makeResult([]), "current-profile", "0.6.0", createdAt);
}

function makeComparison(
	statuses: Map<string, "new" | "persisting">,
	available = true,
): LifecycleComparison {
	return {
		available,
		...(available ? {} : { reason: "settings-changed" as const }),
		statuses,
		resolvedIssues: [],
	};
}

function completedOutcome(
	issues: Issue[],
	statuses: Map<string, "new" | "persisting">,
	available = true,
): ScanSessionOutcome {
	return {
		status: "completed",
		result: makeResult(issues),
		comparison: makeComparison(statuses, available),
	};
}

describe("decideAutomaticScan", () => {
	it("stays disabled at the default interval of zero", () => {
		expect(decideAutomaticScan({
			settings: makeSettings(),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "disabled" });
	});

	it("treats negative intervals as disabled", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = -1; }),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "disabled" });
	});

	it("skips while an operation is active even when stale", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: true,
		})).toEqual({ run: false, reason: "busy" });
	});

	it("skips while the last successful scan is fresh", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(23 * HOUR_MS),
			now: 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "fresh" });
	});

	it("runs when the last successful scan is exactly the interval old", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(0),
			now: 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: true });
	});

	it("runs when there is no snapshot yet", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 1; }),
			snapshot: null,
			now: 0,
			busy: false,
		})).toEqual({ run: true });
	});
});

describe("automaticScanSettings", () => {
	it("excludes the external-link scanner by default", () => {
		const adjusted = automaticScanSettings(makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
		}));

		expect(adjusted.enabledScanners["external-links"]).toBe(false);
	});

	it("keeps the external-link scanner when network checks are enabled", () => {
		const adjusted = automaticScanSettings(makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
			s.automaticScanNetworkChecks = true;
		}));

		expect(adjusted.enabledScanners["external-links"]).toBe(true);
	});

	it("never mutates the given settings and keeps other scanners intact", () => {
		const original = makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
			s.enabledScanners["broken-links"] = false;
		});
		const before = structuredClone(original);

		const adjusted = automaticScanSettings(original);

		expect(original).toEqual(before);
		expect(adjusted).not.toBe(original);
		expect(adjusted.enabledScanners["broken-links"]).toBe(false);
		expect(adjusted.enabledScanners["empty-notes"]).toBe(
			original.enabledScanners["empty-notes"],
		);
	});
});

describe("confirmedNewIssues", () => {
	it("returns only new confirmed errors from the active result", () => {
		const error = makeIssue("error", "confirmed", "error");
		const warning = makeIssue("warning", "confirmed", "warning");
		const info = makeIssue("info", "confirmed", "info");
		const candidate = makeIssue("candidate", "candidate", "error");
		const persisting = makeIssue("persisting", "confirmed", "error");
		const result = makeResult([error, warning, info, candidate, persisting]);

		const issues = confirmedNewIssues(
			result,
			makeComparison(new Map([
				[error.fingerprint, "new"],
				[warning.fingerprint, "new"],
				[info.fingerprint, "new"],
				[candidate.fingerprint, "new"],
				[persisting.fingerprint, "persisting"],
			])),
		);

		expect(issues.map((issue) => issue.fingerprint)).toEqual(["error"]);
	});

	it("ignores ignored findings even when they are new", () => {
		const ignored = makeIssue("ignored");
		const result = makeResult([], [ignored]);

		const issues = confirmedNewIssues(
			result,
			makeComparison(new Map([[ignored.fingerprint, "new"]])),
		);

		expect(issues).toEqual([]);
	});

	it("returns nothing when the comparison is unavailable", () => {
		const current = makeIssue("current");

		expect(confirmedNewIssues(
			makeResult([current]),
			makeComparison(new Map([[current.fingerprint, "new"]]), false),
		)).toEqual([]);
	});
});

describe("automaticScanNotice", () => {
	it("uses the singular form for one issue", () => {
		expect(automaticScanNotice([makeIssue("only")]))
			.toBe("Vault Inspector automatic scan found 1 new confirmed error.");
	});

	it("uses the plural form for several issues", () => {
		expect(automaticScanNotice([makeIssue("a"), makeIssue("b")]))
			.toBe("Vault Inspector automatic scan found 2 new confirmed errors.");
	});
});

function makeSchedulerDeps(options: {
	settings?: InspectorSettings;
	snapshot?: ScanSnapshot | null;
	now?: number;
	busy?: boolean;
	outcome?: ScanSessionOutcome;
} = {}) {
	let settings = options.settings ?? makeSettings((s) => {
		s.automaticScanIntervalHours = 24;
	});
	const runAutomaticScan = vi.fn(async (_settings: InspectorSettings) =>
		options.outcome ?? completedOutcome([], new Map())
	);
	const whenSettled = vi.fn((run: () => void) => { settleCallbacks.push(run); });
	const settleCallbacks: Array<() => void> = [];
	const notifications: string[] = [];
	const deps: StartupScanSchedulerDeps = {
		getSettings: () => settings,
		getSnapshot: () => options.snapshot ?? null,
		isBusy: () => options.busy ?? false,
		now: () => options.now ?? 48 * HOUR_MS,
		whenSettled,
		runAutomaticScan,
		notify: (message) => notifications.push(message),
	};
	return {
		deps,
		runAutomaticScan,
		notifications,
		settle: () => { for (const run of settleCallbacks.splice(0)) run(); },
		setSettings: (next: InspectorSettings) => { settings = next; },
	};
}

describe("createStartupScanScheduler", () => {
	it("defers the check until the workspace settles", () => {
		const subject = makeSchedulerDeps();
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();

		expect(subject.runAutomaticScan).not.toHaveBeenCalled();
		subject.settle();
		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("skips silently when disabled, fresh, or busy", () => {
		const disabled = makeSchedulerDeps({
			settings: makeSettings(),
		});
		createStartupScanScheduler(disabled.deps).schedule();
		disabled.settle();
		expect(disabled.runAutomaticScan).not.toHaveBeenCalled();

		const fresh = makeSchedulerDeps({
			snapshot: makeSnapshot(47 * HOUR_MS),
			now: 48 * HOUR_MS,
		});
		createStartupScanScheduler(fresh.deps).schedule();
		fresh.settle();
		expect(fresh.runAutomaticScan).not.toHaveBeenCalled();

		const busy = makeSchedulerDeps({ busy: true });
		createStartupScanScheduler(busy.deps).schedule();
		busy.settle();
		expect(busy.runAutomaticScan).not.toHaveBeenCalled();

		expect(disabled.notifications).toEqual([]);
	});

	it("runs with scheduler-adjusted settings that exclude network checks", async () => {
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			settings: makeSettings((s) => {
				s.automaticScanIntervalHours = 24;
				s.enabledScanners["external-links"] = true;
			}),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		const passed = subject.runAutomaticScan.mock.calls[0][0];
		expect(passed).not.toBe(subject.deps.getSettings());
		expect(passed.enabledScanners["external-links"]).toBe(false);
	});

	it("schedules only once per activation even if settle fires again", () => {
		const subject = makeSchedulerDeps({ snapshot: makeSnapshot(0) });
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();
		scheduler.schedule();
		expect(subject.runAutomaticScan).not.toHaveBeenCalled();
		subject.settle();
		subject.settle();

		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("reads the settings at fire time", () => {
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			settings: makeSettings(),
		});
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();
		subject.setSettings(makeSettings((s) => {
			s.automaticScanIntervalHours = 24;
		}));
		subject.settle();

		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("notifies once when a completed scan finds new confirmed errors", async () => {
		const fresh = makeIssue("fresh");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[fresh],
				new Map([[fresh.fingerprint, "new"]]),
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.notifications.length).toBe(1),
		);

		expect(subject.notifications).toEqual([
			"Vault Inspector automatic scan found 1 new confirmed error.",
		]);
	});

	it("stays silent when a new finding is only a confirmed warning", async () => {
		const warning = makeIssue("warning", "confirmed", "warning");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[warning],
				new Map([[warning.fingerprint, "new"]]),
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(subject.notifications).toEqual([]);
	});

	it("stays silent when no finding is newly confirmed", async () => {
		const persisting = makeIssue("persisting");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[persisting],
				new Map([[persisting.fingerprint, "persisting"]]),
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(subject.notifications).toEqual([]);
	});

	it("stays silent when the comparison is unavailable", async () => {
		const current = makeIssue("current");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[current],
				new Map([[current.fingerprint, "new"]]),
				false,
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(subject.notifications).toEqual([]);
	});

	it("stays silent when the scan fails or persistence warns", async () => {
		const failed = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: { status: "failed", message: "scanner exploded" },
		});
		createStartupScanScheduler(failed.deps).schedule();
		failed.settle();
		await vi.waitFor(() =>
			expect(failed.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		const warned = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: {
				status: "completed",
				result: makeResult([makeIssue("current")]),
				comparison: makeComparison(
					new Map([["current", "new" as const]]),
				),
				persistWarning: "disk unavailable",
			},
		});
		createStartupScanScheduler(warned.deps).schedule();
		warned.settle();
		await vi.waitFor(() =>
			expect(warned.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(failed.notifications).toEqual([]);
		expect(warned.notifications).toEqual([]);
	});

	it("swallows a rejecting automatic scan without an unhandled rejection", async () => {
		const subject = makeSchedulerDeps({ snapshot: makeSnapshot(0) });
		subject.runAutomaticScan.mockRejectedValueOnce(new Error("queue unavailable"));

		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);
		await Promise.resolve();

		expect(subject.notifications).toEqual([]);
	});
});
