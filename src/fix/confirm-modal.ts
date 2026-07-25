import { App, Modal } from "obsidian";
import type { FixAction } from "../scanner/Issue";

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

export function showConfirmModal(app: App, actions: FixAction[]): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmFixModal(app, actions, resolve);
		modal.open();
	});
}

class ConfirmFixModal extends Modal {
	private actions: FixAction[];
	private resolve: (confirmed: boolean) => void;

	constructor(app: App, actions: FixAction[], resolve: (confirmed: boolean) => void) {
		super(app);
		this.actions = actions;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("vi-confirm-modal");

		const summary = summarizeFixActions(this.actions);

		contentEl.createEl("h3", {
			text: summary.title,
		});
		contentEl.createEl("p", { text: summary.description });

		if (this.actions.length > 1) {
			const list = contentEl.createDiv({ cls: "vi-file-list" });
			for (const path of summary.paths) {
				list.createDiv({ cls: "vi-file-list-item", text: path });
			}
		}

		const btnRow = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => { this.resolve(false); this.close(); });
		const confirmBtn = btnRow.createEl("button", { cls: "vi-confirm-destructive", text: "Confirm" });
		confirmBtn.addEventListener("click", () => { this.resolve(true); this.close(); });
	}

	onClose() {
		this.contentEl.empty();
		this.resolve(false);
	}
}
