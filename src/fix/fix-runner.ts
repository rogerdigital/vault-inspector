import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import type { ActionOutcome } from "./action-outcomes";
import {
	getFreshFixAction,
	type FixDecision,
} from "./fix-decisions";

export type FixRunnerDependencies = {
	scan: () => Promise<ScanResult | null>;
	execute: (action: FixAction) => Promise<number>;
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
	const decisionsByFingerprint = new Map(
		decisions.map((decision) => [decision.fingerprint, decision]),
	);
	const outcomes: Array<ActionOutcome | null> = issues.map(() => null);
	const pending: PendingAction[] = [];

	for (const [index, issue] of issues.entries()) {
		const decision = decisionsByFingerprint.get(issue.fingerprint);
		if (!decision) {
			outcomes[index] = skipped(
				issue,
				"No confirmed fix decision was available.",
			);
			continue;
		}

		const freshResult = await dependencies.scan();
		const freshIssue = freshResult
			? [...freshResult.issues, ...freshResult.ignoredIssues].find(
				(candidate) => candidate.fingerprint === issue.fingerprint,
			)
			: undefined;
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
			pending.push({
				index,
				fingerprint: issue.fingerprint,
				affectedPaths: [...freshAction.targetPaths],
				affectedCount: await dependencies.execute(freshAction),
			});
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

	const verificationResult = await dependencies.scan();
	if (!verificationResult) {
		for (const action of pending) {
			outcomes[action.index] = {
				fingerprint: action.fingerprint,
				outcome: "failed",
				phase: "verification",
				message: "The final verification scan did not complete.",
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
