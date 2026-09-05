import { App, Modal, TFile } from "obsidian";
import type {
	FixAction,
	Issue,
	KeepOneSelection,
} from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";
import { formatSize } from "../utils/format";
import {
	buildFixDecisionState,
	type FixDecision,
	resolveDecisionAction,
} from "./fix-decisions";
import {
	describeEligibility,
	resolveEligibility,
} from "./fix-eligibility";

export type FixActionSummary = {
	title: string;
	description: string;
	paths: string[];
};

export function describeFixActions(actions: FixAction[]): string {
	const modifiedNotes = new Set(
		actions
			.filter((action) => action.kind === "remove-link-text")
			.flatMap((action) => action.targetPaths),
	);
	const trashedFiles = new Set(
		actions
			.filter((action) => action.kind === "trash-file")
			.flatMap((action) => action.targetPaths),
	);
	const parts: string[] = [];

	if (modifiedNotes.size > 0) {
		parts.push(`modify ${modifiedNotes.size} ${pluralize("note", modifiedNotes.size)}`);
	}
	if (trashedFiles.size > 0) {
		parts.push(`move ${trashedFiles.size} ${pluralize("file", trashedFiles.size)} to trash`);
	}

	const description = parts.join(" and ");
	return description.length > 0
		? description.charAt(0).toUpperCase() + description.slice(1)
		: "Apply selected fixes";
}

export function summarizeFixActions(actions: FixAction[]): FixActionSummary {
	const isBatch = actions.length > 1;
	const impact = describeFixActions(actions);

	return {
		title: isBatch ? `Confirm batch fix (${actions.length} actions)` : "Confirm fix",
		description: isBatch
			? `This will ${impact.charAt(0).toLowerCase()}${impact.slice(1)}.`
			: actions[0]?.description ?? "No fix action selected.",
		paths: [...new Set(actions.flatMap((action) => action.targetPaths))],
	};
}

function pluralize(noun: string, count: number): string {
	return count === 1 ? noun : `${noun}s`;
}

export function createSingleUseResolver<T>(
	resolve: (value: T) => void,
): (value: T) => boolean {
	let settled = false;
	return (value) => {
		if (settled) return false;
		settled = true;
		resolve(value);
		return true;
	};
}

export function showConfirmModal(
	app: App,
	issues: Issue[],
	mode: DuplicateKeepMode,
): Promise<FixDecision[] | null> {
	return new Promise((resolve) => {
		new ConfirmFixModal(app, issues, mode, resolve).open();
	});
}

/**
 * A keep-choice radio group is shown in always-ask mode, and for any group
 * flagged requiresReview (2+ referenced paths) regardless of mode — the
 * explicit choice is what unlocks the Confirm button.
 */
export function shouldAskForKeep(
	mode: DuplicateKeepMode,
	selection: KeepOneSelection,
): boolean {
	return mode === "always-ask" || selection.requiresReview === true;
}

export type EligibilityGroups = {
	eligible: Issue[];
	reviewRequired: Issue[];
	blocked: Issue[];
};

export function groupByEligibility(issues: Issue[]): EligibilityGroups {
	const groups: EligibilityGroups = {
		eligible: [],
		reviewRequired: [],
		blocked: [],
	};
	for (const issue of issues) {
		if (!issue.fixAction) continue;
		const eligibility = resolveEligibility(issue);
		if (eligibility === "eligible") groups.eligible.push(issue);
		else if (eligibility === "blocked") groups.blocked.push(issue);
		else groups.reviewRequired.push(issue);
	}
	return groups;
}

/**
 * Whether a review-required item has its explicit per-item decision:
 * a valid keep choice for duplicate groups (the Milestone 1 radio flow),
 * an approved fingerprint for everything else.
 */
export function isReviewApproved(
	issue: Issue,
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
	approvedReviews: ReadonlySet<string>,
): boolean {
	const selection = issue.fixAction?.selection;
	if (selection && shouldAskForKeep(mode, selection)) {
		const keepPath = selectedKeeps.get(issue.fingerprint);
		return keepPath !== undefined
			&& selection.candidatePaths.includes(keepPath);
	}
	return approvedReviews.has(issue.fingerprint);
}

export type ConfirmationPlan = {
	groups: EligibilityGroups;
	/** Eligible issues plus approved review-required issues. */
	actionable: Issue[];
	/** True when at least one action exists and every actionable decision resolves. */
	complete: boolean;
};

export function buildConfirmationPlan(
	issues: Issue[],
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
	approvedReviews: ReadonlySet<string>,
): ConfirmationPlan {
	const groups = groupByEligibility(issues);
	const actionable = [
		...groups.eligible,
		...groups.reviewRequired.filter((issue) =>
			isReviewApproved(issue, mode, selectedKeeps, approvedReviews)),
	];
	const state = buildFixDecisionState(actionable, mode, selectedKeeps);
	return {
		groups,
		actionable,
		complete: actionable.length > 0 && state.complete,
	};
}

export type FileStatInfo = { size: number; mtime: number };

export type ImpactRow = {
	path: string;
	size: string;
	mtime: string;
};

/**
 * Impact preview rows for an action's target paths. Paths missing from the
 * stat map render explicit "unknown" text — every target path is always
 * listed, never silently dropped.
 */
export function buildImpactRows(
	paths: string[],
	stats: ReadonlyMap<string, FileStatInfo>,
): ImpactRow[] {
	return paths.map((path) => {
		const stat = stats.get(path);
		return {
			path,
			size: stat ? formatSize(stat.size) : "Size unknown",
			mtime: stat
				? new Date(stat.mtime).toLocaleDateString()
				: "Modified date unknown",
		};
	});
}

class ConfirmFixModal extends Modal {
	private issues: Issue[];
	private mode: DuplicateKeepMode;
	private selectedKeeps = new Map<string, string>();
	private approvedReviews = new Set<string>();
	private settle: (result: FixDecision[] | null) => boolean;

	constructor(
		app: App,
		issues: Issue[],
		mode: DuplicateKeepMode,
		resolve: (result: FixDecision[] | null) => void,
	) {
		super(app);
		this.issues = issues;
		this.mode = mode;
		this.settle = createSingleUseResolver(resolve);
	}

	onOpen() {
		this.contentEl.addClass("vi-confirm-modal");
		this.renderContent();
	}

	onClose() {
		this.contentEl.empty();
		this.settle(null);
	}

	private finish(result: FixDecision[] | null): void {
		if (this.settle(result)) this.close();
	}

	private collectStats(paths: string[]): Map<string, FileStatInfo> {
		const stats = new Map<string, FileStatInfo>();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				stats.set(path, { size: file.stat.size, mtime: file.stat.mtime });
			}
		}
		return stats;
	}

	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");

		const plan = buildConfirmationPlan(
			this.issues,
			this.mode,
			this.selectedKeeps,
			this.approvedReviews,
		);
		const state = buildFixDecisionState(
			plan.actionable,
			this.mode,
			this.selectedKeeps,
		);
		const actions = plan.actionable.flatMap((issue) => {
			const decision = state.decisions.find(
				(candidate) => candidate.fingerprint === issue.fingerprint,
			);
			if (!decision) return [];
			const action = resolveDecisionAction(issue, decision);
			return action ? [action] : [];
		});
		const summary = summarizeFixActions(actions);

		contentEl.createEl("h3", {
			text: this.issues.length > 1
				? `Confirm batch fix (${this.issues.length} actions)`
				: "Confirm fix",
		});
		contentEl.createEl("p", {
			text: plan.complete
				? summary.description
				: "Approve at least one fix and choose one file to keep in every duplicate group.",
		});

		const stats = this.collectStats([
			...new Set(
				this.issues.flatMap((issue) => issue.fixAction?.targetPaths ?? []),
			),
		]);

		for (const issue of this.issues) {
			this.renderImpactCard(contentEl, issue, stats);
		}

		const btnRow = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.finish(null));
		const confirmBtn = btnRow.createEl("button", {
			cls: "vi-confirm-destructive",
			text: "Confirm",
		});
		confirmBtn.disabled = !plan.complete;
		confirmBtn.addEventListener("click", () => {
			if (plan.complete) this.finish(state.decisions);
		});
	}

	private renderImpactCard(
		container: HTMLElement,
		issue: Issue,
		stats: ReadonlyMap<string, FileStatInfo>,
	): void {
		const action = issue.fixAction;
		if (!action) return;
		const eligibility = resolveEligibility(issue);
		const explanation = describeEligibility(issue);
		const approved = eligibility === "eligible"
			|| isReviewApproved(
				issue,
				this.mode,
				this.selectedKeeps,
				this.approvedReviews,
			);

		const card = container.createDiv({
			cls: eligibility === "review-required" && !approved
				? "vi-impact-card vi-impact-card-muted"
				: "vi-impact-card",
		});
		const titleRow = card.createDiv({ cls: "vi-impact-card-title-row" });
		titleRow.createSpan({ cls: "vi-impact-card-title", text: issue.title });
		titleRow.createSpan({
			cls: `vi-eligibility-badge vi-eligibility-${eligibility}`,
			text: explanation.status,
		});
		card.createDiv({ cls: "vi-impact-reason", text: explanation.reason });

		const rows = card.createDiv({ cls: "vi-impact-rows" });
		for (const row of buildImpactRows(action.targetPaths, stats)) {
			const rowEl = rows.createDiv({ cls: "vi-impact-row" });
			rowEl.createSpan({
				cls: "vi-impact-row-path",
				text: row.path,
			});
			rowEl.createSpan({
				cls: "vi-impact-row-meta",
				text: `${row.size} · modified ${row.mtime}`,
			});
		}

		if (issue.impact) {
			card.createDiv({
				cls: "vi-impact-coverage",
				text: `Inbound references: ${issue.impact.inboundReferences} · Reference coverage: ${issue.impact.coverageComplete ? "complete" : "incomplete"}`,
			});
		}

		const selection = action.selection;
		if (selection) {
			const keepPath = this.selectedKeeps.get(issue.fingerprint)
				?? selection.automaticKeepPath;
			card.createDiv({ cls: "vi-impact-keep", text: `Keep: ${keepPath}` });
		}

		if (selection && shouldAskForKeep(this.mode, selection)) {
			const group = card.createDiv({ cls: "vi-keep-group" });
			group.createDiv({
				cls: "vi-keep-group-title",
				text: "Choose one file to keep",
			});
			const referencedPaths = selection.referencedPaths ?? [];
			if (referencedPaths.length >= 2) {
				group.createDiv({
					cls: "vi-keep-group-impact",
					text: `${referencedPaths.length} of ${selection.candidatePaths.length} files are referenced by notes: ${referencedPaths.join(", ")}. Choose which location to keep — references are never rewritten.`,
				});
			}
			for (const path of selection.candidatePaths) {
				const option = group.createEl("label", { cls: "vi-keep-option" });
				const radio = option.createEl("input", { type: "radio" });
				radio.name = `keep-${issue.fingerprint}`;
				radio.checked =
					this.selectedKeeps.get(issue.fingerprint) === path;
				radio.addEventListener("change", () => {
					this.selectedKeeps.set(issue.fingerprint, path);
					this.renderContent();
				});
				option.createSpan({ cls: "vi-keep-option-path", text: path });
			}
		}

		if (eligibility === "review-required" && !selection) {
			const label = card.createEl("label", { cls: "vi-review-checkbox" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.approvedReviews.has(issue.fingerprint);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.approvedReviews.add(issue.fingerprint);
				} else {
					this.approvedReviews.delete(issue.fingerprint);
				}
				this.renderContent();
			});
			label.createSpan({ text: "I reviewed this file" });
		}
	}
}
