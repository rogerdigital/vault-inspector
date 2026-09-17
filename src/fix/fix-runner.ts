import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import type { InspectorSettings } from "../settings/settings";
import type { ActionOutcome } from "./action-outcomes";
import {
	getFreshFixAction,
	isBlockedFromExecution,
	type FixDecision,
} from "./fix-decisions";
import { METADATA_NOT_READY } from "./metadata-write-fence";

export type FixRunnerDependencies = {
	/** Read live settings once; the batch clones and freezes the value for every scan. */
	settings: () => InspectorSettings;
	/** Receives a clone of the frozen settings on every call (preflights + final verification). */
	scan: (settings: InspectorSettings) => Promise<ScanResult | null>;
	/** Executors may return a number (legacy) or a result carrying verification readiness. */
	execute: (action: FixAction) => Promise<number | FixExecutionResult>;
	/** Optional batch-wide guard; false stops all further scans and mutations. */
	canScan?: () => boolean;
};

export type FixExecutionResult = {
	affectedCount: number;
	verificationReady: boolean;
	verificationMessage?: string;
};

export type FixBatchResult = {
	outcomes: ActionOutcome[];
	verificationResult: ScanResult | null;
};

type PendingAction = {
	index: number;
	fingerprint: string;
	affectedPaths: string[];
	affectedCount: number;
};

export async function runFixBatch(
	issues: Issue[],
	decisions: FixDecision[],
	dependencies: FixRunnerDependencies,
): Promise<FixBatchResult> {
	const frozenSettings = structuredClone(dependencies.settings());
	// Set when a write succeeded but its cache synchronization could not be
	// confirmed: later preflights would read stale metadata and must not run.
	let verificationProblem: string | undefined;
	const scanOnce = () => {
		if (verificationProblem || dependencies.canScan?.() === false) return Promise.resolve(null);
		return dependencies.scan(structuredClone(frozenSettings));
	};

	const decisionsByFingerprint = new Map(
		decisions.map((decision) => [decision.fingerprint, decision]),
	);
	const outcomes: Array<ActionOutcome | null> = issues.map(() => null);
	const pending: PendingAction[] = [];
	let scannedDuringBatch = false;

	for (const [index, issue] of issues.entries()) {
		if (verificationProblem || dependencies.canScan?.() === false) {
			outcomes[index] = skipped(issue, METADATA_NOT_READY);
			continue;
		}
		if (isBlockedFromExecution(issue)) {
			outcomes[index] = skipped(
				issue,
				"The fix is blocked by the action policy.",
			);
			continue;
		}

		const decision = decisionsByFingerprint.get(issue.fingerprint);
		if (!decision) {
			outcomes[index] = skipped(
				issue,
				"No confirmed fix decision was available.",
			);
			continue;
		}

		const freshResult = await scanOnce();
		scannedDuringBatch = true;
		const freshIssue = freshResult
			? [...freshResult.issues, ...freshResult.ignoredIssues].find(
				(candidate) => candidate.fingerprint === issue.fingerprint,
			)
			: undefined;
		if (freshIssue && isBlockedFromExecution(freshIssue)) {
			outcomes[index] = skipped(
				issue,
				"The finding was re-evaluated as blocked before execution.",
			);
			continue;
		}
		const freshAction = getFreshFixAction(issue, freshIssue, decision);
		if (!freshAction) {
			outcomes[index] = skipped(
				issue,
				freshResult
					? "The finding or fix evidence changed before execution."
					: "The preflight scan did not complete.",
			);
			continue;
		}

		try {
			const raw = await dependencies.execute(freshAction);
			const execution = typeof raw === "number"
				? { affectedCount: raw, verificationReady: true }
				: raw;
			pending.push({
				index,
				fingerprint: issue.fingerprint,
				affectedPaths: [...freshAction.targetPaths],
				affectedCount: execution.affectedCount,
			});
			if (!execution.verificationReady) {
				verificationProblem = execution.verificationMessage ?? METADATA_NOT_READY;
			}
		} catch (error) {
			outcomes[index] = {
				fingerprint: issue.fingerprint,
				outcome: "failed",
				phase: "execution",
				message: error instanceof Error ? error.message : String(error),
				affectedPaths: [...freshAction.targetPaths],
			};
		}
	}

	// Nothing was scanned and nothing executed (every item skipped before any
	// preflight): there is no batch state to verify, so skip the final scan.
	const verificationResult = pending.length > 0 || scannedDuringBatch
		? await scanOnce()
		: null;
	if (!verificationResult) {
		for (const action of pending) {
			outcomes[action.index] = {
				fingerprint: action.fingerprint,
				outcome: "failed",
				phase: "verification",
				message: verificationProblem ?? (
					dependencies.canScan?.() === false
						? METADATA_NOT_READY
						: "The final verification scan did not complete."
				),
				affectedPaths: action.affectedPaths,
			};
		}
	} else {
		const remaining = new Set([
			...verificationResult.issues,
			...verificationResult.ignoredIssues,
		].map((issue) => issue.fingerprint));
		for (const action of pending) {
			const stillPresent = remaining.has(action.fingerprint);
			outcomes[action.index] = {
				fingerprint: action.fingerprint,
				outcome: stillPresent ? "still-present" : "fixed",
				message: stillPresent
					? `The finding remains after ${action.affectedCount} change(s).`
					: `Verified after ${action.affectedCount} change(s).`,
				affectedPaths: action.affectedPaths,
			};
		}
	}

	return {
		outcomes: outcomes.filter(
			(outcome): outcome is ActionOutcome => outcome !== null,
		),
		verificationResult,
	};
}

function skipped(issue: Issue, message: string): ActionOutcome {
	return {
		fingerprint: issue.fingerprint,
		outcome: "skipped",
		phase: "preflight",
		message,
		affectedPaths: [...(issue.fixAction?.targetPaths ?? [])],
	};
}
