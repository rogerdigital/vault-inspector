import { App, Modal } from "obsidian";
import type { FixAction, Issue } from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";
import {
	buildFixDecisionState,
	type FixDecision,
	resolveDecisionAction,
} from "./fix-decisions";

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

class ConfirmFixModal extends Modal {
	private issues: Issue[];
	private mode: DuplicateKeepMode;
	private selectedKeeps = new Map<string, string>();
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

	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");

		const state = buildFixDecisionState(
			this.issues,
			this.mode,
			this.selectedKeeps,
		);
		const decisionsByFingerprint = new Map(
			state.decisions.map((decision) => [decision.fingerprint, decision]),
		);
		const actions = this.issues.flatMap((issue) => {
			const decision = decisionsByFingerprint.get(issue.fingerprint);
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
			text: state.complete
				? summary.description
				: "Choose one file to keep in every duplicate group.",
		});

		if (this.mode === "always-ask") {
			for (const issue of this.issues) {
				const selection = issue.fixAction?.selection;
				if (!selection) continue;
				const group = contentEl.createDiv({ cls: "vi-keep-group" });
				group.createDiv({
					cls: "vi-keep-group-title",
					text: "Choose one file to keep",
				});
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
		}

		if (this.issues.length > 1 || actions.length > 1) {
			const list = contentEl.createDiv({ cls: "vi-file-list" });
			for (const path of summary.paths) {
				list.createDiv({ cls: "vi-file-list-item", text: path });
			}
		}

		const btnRow = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.finish(null));
		const confirmBtn = btnRow.createEl("button", {
			cls: "vi-confirm-destructive",
			text: "Confirm",
		});
		confirmBtn.disabled = !state.complete;
		confirmBtn.addEventListener("click", () => {
			if (state.complete) this.finish(state.decisions);
		});
	}
}
