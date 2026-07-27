import type { FixAction, Issue } from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";

export type FixDecision = {
	fingerprint: string;
	keepPath?: string;
};

export type FixDecisionState = {
	complete: boolean;
	decisions: FixDecision[];
};

export function buildFixDecisionState(
	issues: Issue[],
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
): FixDecisionState {
	const decisions: FixDecision[] = [];
	let complete = true;

	for (const issue of issues) {
		const action = issue.fixAction;
		if (!action) continue;
		const selection = action.selection;
		if (!selection) {
			decisions.push({ fingerprint: issue.fingerprint });
			continue;
		}
		const keepPath = mode === "automatic"
			? selection.automaticKeepPath
			: selectedKeeps.get(issue.fingerprint);
		if (!keepPath || !selection.candidatePaths.includes(keepPath)) {
			complete = false;
			continue;
		}
		decisions.push({ fingerprint: issue.fingerprint, keepPath });
	}

	return { complete, decisions };
}

export function resolveDecisionAction(
	issue: Issue,
	decision: FixDecision,
): FixAction | null {
	const action = issue.fixAction;
	if (!action || decision.fingerprint !== issue.fingerprint) return null;
	const selection = action.selection;
	if (!selection) return decision.keepPath === undefined ? action : null;
	if (
		!decision.keepPath
		|| !selection.candidatePaths.includes(decision.keepPath)
	) {
		return null;
	}
	const targetPaths = selection.candidatePaths.filter(
		(path) => path !== decision.keepPath,
	);
	return {
		...action,
		description:
			`Keep "${decision.keepPath}" and move ${targetPaths.length} duplicate(s) to trash`,
		targetPaths,
	};
}

export function getFreshFixAction(
	requestedIssue: Issue,
	freshIssue: Issue | undefined,
	decision: FixDecision,
): FixAction | null {
	const requested = requestedIssue.fixAction;
	const fresh = freshIssue?.fixAction;
	if (
		decision.fingerprint !== requestedIssue.fingerprint
		|| freshIssue?.fingerprint !== requestedIssue.fingerprint
		|| !requested
		|| !fresh
	) {
		return null;
	}

	if (requested.selection || fresh.selection) {
		if (
			!requested.selection
			|| !fresh.selection
			|| requested.kind !== fresh.kind
			|| requested.label !== fresh.label
			|| !samePaths(
				requested.selection.candidatePaths,
				fresh.selection.candidatePaths,
			)
		) {
			return null;
		}
		return resolveDecisionAction(freshIssue, decision);
	}

	return fixActionsMatch(requested, fresh) ? fresh : null;
}

function samePaths(left: string[], right: string[]): boolean {
	const sortedLeft = left.slice().sort();
	const sortedRight = right.slice().sort();
	return sortedLeft.length === sortedRight.length
		&& sortedRight.every((path, index) => path === sortedLeft[index]);
}

function fixActionsMatch(left: FixAction, right: FixAction): boolean {
	return left.kind === right.kind
		&& left.label === right.label
		&& left.description === right.description
		&& left.linkText === right.linkText
		&& left.targetPaths.length === right.targetPaths.length
		&& left.targetPaths.every(
			(path, index) => path === right.targetPaths[index],
		);
}
