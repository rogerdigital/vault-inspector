import { describe, expect, it, vi } from "vitest";
import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { runFixBatch } from "../fix/fix-runner";

function action(
	targetPath: string,
	overrides: Partial<FixAction> = {},
): FixAction {
	return {
		kind: "trash-file",
		label: "Move to trash",
		description: `Move ${targetPath} to trash`,
		targetPaths: [targetPath],
		...overrides,
	};
}

function issue(
	fingerprint: string,
	fixAction: FixAction = action(`${fingerprint}.md`),
): Issue {
	return {
		scannerId: "empty-notes",
		severity: "warning",
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		primaryPath: fixAction.targetPaths[0],
		relatedPaths: [],
		evidence: {},
		fingerprint,
		fixAction,
	};
}

function result(
	issues: Issue[] = [],
	ignoredIssues: Issue[] = [],
): ScanResult {
	return {
		startedAt: 0,
		finishedAt: 1,
		issues,
		ignoredIssues,
		filesScanned: 1,
		scannersRun: ["empty-notes"],
	};
}

describe("runFixBatch", () => {
	it("marks an executed action fixed when final verification no longer finds it", async () => {
		const requested = issue("fixed");
		const finalResult = result([]);
		const scan = vi.fn()
			.mockResolvedValueOnce(result([requested]))
			.mockResolvedValueOnce(finalResult);

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: requested.fingerprint }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(2) },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "fixed",
			outcome: "fixed",
			message: "Verified after 2 change(s).",
			affectedPaths: ["fixed.md"],
		}]);
		expect(batch.verificationResult).toBe(finalResult);
		expect(scan).toHaveBeenCalledTimes(2);
	});

	it("marks an executed action still present when final verification finds it", async () => {
		const requested = issue("present");
		const scan = vi.fn()
			.mockResolvedValueOnce(result([requested]))
			.mockResolvedValueOnce(result([requested]));

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: requested.fingerprint }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "present",
			outcome: "still-present",
			message: "The finding remains after 1 change(s).",
			affectedPaths: ["present.md"],
		}]);
	});

	it("skips changed fix evidence during preflight", async () => {
		const requested = issue("changed");
		const changed = issue("changed", action("changed.md", {
			description: "Changed fix evidence",
		}));
		const execute = vi.fn();
		const scan = vi.fn()
			.mockResolvedValueOnce(result([changed]))
			.mockResolvedValueOnce(result([changed]));

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: requested.fingerprint }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "changed",
			outcome: "skipped",
			phase: "preflight",
			message: "The finding or fix evidence changed before execution.",
			affectedPaths: ["changed.md"],
		}]);
		expect(execute).not.toHaveBeenCalled();
	});

	it("reports a missing confirmed decision in its original outcome slot", async () => {
		const missing = issue("missing");
		const confirmed = issue("confirmed");
		const scan = vi.fn()
			.mockResolvedValueOnce(result([confirmed]))
			.mockResolvedValueOnce(result([]));

		const batch = await runFixBatch(
			[missing, confirmed],
			[{ fingerprint: confirmed.fingerprint }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(batch.outcomes.map((outcome) => outcome.fingerprint)).toEqual([
			"missing",
			"confirmed",
		]);
		expect(batch.outcomes[0]).toEqual({
			fingerprint: "missing",
			outcome: "skipped",
			phase: "preflight",
			message: "No confirmed fix decision was available.",
			affectedPaths: ["missing.md"],
		});
	});

	it("reports a null preflight scan and continues to final verification", async () => {
		const requested = issue("scan-failed");
		const finalResult = result([]);
		const scan = vi.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(finalResult);
		const execute = vi.fn();

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: requested.fingerprint }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "scan-failed",
			outcome: "skipped",
			phase: "preflight",
			message: "The preflight scan did not complete.",
			affectedPaths: ["scan-failed.md"],
		}]);
		expect(batch.verificationResult).toBe(finalResult);
		expect(execute).not.toHaveBeenCalled();
	});

	it("preserves an execution error and continues with later actions", async () => {
		const failed = issue("failed");
		const later = issue("later");
		const scan = vi.fn()
			.mockResolvedValueOnce(result([failed, later]))
			.mockResolvedValueOnce(result([later]))
			.mockResolvedValueOnce(result([]));
		const execute = vi.fn()
			.mockRejectedValueOnce(new Error("trash unavailable"))
			.mockResolvedValueOnce(3);

		const batch = await runFixBatch(
			[failed, later],
			[failed, later].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([
			{
				fingerprint: "failed",
				outcome: "failed",
				phase: "execution",
				message: "trash unavailable",
				affectedPaths: ["failed.md"],
			},
			{
				fingerprint: "later",
				outcome: "fixed",
				message: "Verified after 3 change(s).",
				affectedPaths: ["later.md"],
			},
		]);
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("converts every pending action to a verification failure when final scan is null", async () => {
		const first = issue("first");
		const second = issue("second");
		const scan = vi.fn()
			.mockResolvedValueOnce(result([first, second]))
			.mockResolvedValueOnce(result([first, second]))
			.mockResolvedValueOnce(null);

		const batch = await runFixBatch(
			[first, second],
			[first, second].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(batch.verificationResult).toBeNull();
		expect(batch.outcomes).toEqual([first, second].map((item) => ({
			fingerprint: item.fingerprint,
			outcome: "failed",
			phase: "verification",
			message: "The final verification scan did not complete.",
			affectedPaths: [`${item.fingerprint}.md`],
		})));
	});

	it("finds fresh and remaining issues in ignored results", async () => {
		const requested = issue("ignored");
		const freshIgnored = issue("ignored", {
			...requested.fixAction!,
			targetPaths: ["ignored/fresh.md"],
		});
		const staleWithMatchingAction = {
			...requested,
			fixAction: freshIgnored.fixAction,
		};
		const scan = vi.fn()
			.mockResolvedValueOnce(result([], [staleWithMatchingAction]))
			.mockResolvedValueOnce(result([], [staleWithMatchingAction]));

		const batch = await runFixBatch(
			[staleWithMatchingAction],
			[{ fingerprint: "ignored" }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(batch.outcomes[0]).toMatchObject({
			fingerprint: "ignored",
			outcome: "still-present",
			affectedPaths: ["ignored/fresh.md"],
		});
	});

	it("keeps input order across fixed, still-present, skipped, and failed outcomes", async () => {
		const fixed = issue("fixed");
		const present = issue("present");
		const changed = issue("changed");
		const failed = issue("failed");
		const scan = vi.fn()
			.mockResolvedValueOnce(result([fixed, present, changed, failed]))
			.mockResolvedValueOnce(result([present, changed, failed]))
			.mockResolvedValueOnce(result([
				present,
				issue("changed", action("changed.md", { label: "Changed" })),
				failed,
			]))
			.mockResolvedValueOnce(result([present, failed]))
			.mockResolvedValueOnce(result([present]));
		const execute = vi.fn()
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(1)
			.mockRejectedValueOnce("executor rejected");

		const batch = await runFixBatch(
			[fixed, present, changed, failed],
			[fixed, present, changed, failed].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([
			expect.objectContaining({ fingerprint: "fixed", outcome: "fixed" }),
			expect.objectContaining({ fingerprint: "present", outcome: "still-present" }),
			expect.objectContaining({
				fingerprint: "changed",
				outcome: "skipped",
				phase: "preflight",
			}),
			expect.objectContaining({
				fingerprint: "failed",
				outcome: "failed",
				phase: "execution",
				message: "executor rejected",
			}),
		]);
	});

	it("returns the exact final result after one preflight per decision and one verification", async () => {
		const first = issue("first");
		const second = issue("second");
		const finalResult = result([]);
		const scan = vi.fn()
			.mockResolvedValueOnce(result([first, second]))
			.mockResolvedValueOnce(result([second]))
			.mockResolvedValueOnce(finalResult);

		const batch = await runFixBatch(
			[first, second],
			[first, second].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(batch.verificationResult).toBe(finalResult);
		expect(scan).toHaveBeenCalledTimes(3);
	});

	it("freezes detection settings for the whole batch", async () => {
		const first = issue("first");
		const second = issue("second");
		const live = { ...DEFAULT_SETTINGS };
		const scan = vi.fn().mockImplementation(async () => {
			live.duplicateKeepMode = "always-ask";
			return result([first, second]);
		});

		const batch = await runFixBatch(
			[first, second],
			[first, second].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => live, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(scan).toHaveBeenCalledTimes(3);
		for (const [received] of scan.mock.calls) {
			expect(received).not.toBe(live);
			expect(received.duplicateKeepMode).toBe(DEFAULT_SETTINGS.duplicateKeepMode);
		}
		expect(batch.outcomes.every((outcome) => outcome.outcome === "still-present")).toBe(true);
	});

	it("never executes an issue that was blocked at request time", async () => {
		const blocked = { ...issue("blocked"), eligibility: "blocked" as const };
		const scan = vi.fn();
		const execute = vi.fn();

		const batch = await runFixBatch(
			[blocked],
			[{ fingerprint: "blocked" }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "blocked",
			outcome: "skipped",
			phase: "preflight",
			message: "The fix is blocked by the action policy.",
			affectedPaths: ["blocked.md"],
		}]);
		expect(scan).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	});

	it("skips when the preflight re-evaluates the finding as blocked", async () => {
		const requested = issue("reblocked");
		const fresh = { ...issue("reblocked"), eligibility: "blocked" as const };
		const scan = vi.fn().mockResolvedValue(result([fresh]));
		const execute = vi.fn();

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: "reblocked" }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "reblocked",
			outcome: "skipped",
			phase: "preflight",
			message: "The finding was re-evaluated as blocked before execution.",
			affectedPaths: ["reblocked.md"],
		}]);
		expect(execute).not.toHaveBeenCalled();
	});
});
