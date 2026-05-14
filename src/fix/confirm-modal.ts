import { App, Modal } from "obsidian";
import type { FixAction } from "../scanner/Issue";

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

		const isBatch = this.actions.length > 1;
		const allPaths = this.actions.flatMap((a) => a.targetPaths);

		contentEl.createEl("h3", {
			text: isBatch ? `Confirm batch cleanup (${allPaths.length} files)` : "Confirm fix",
		});

		if (isBatch) {
			contentEl.createEl("p", {
				text: `This will move ${allPaths.length} file(s) to trash.`,
			});
			const list = contentEl.createDiv({ cls: "vi-file-list" });
			for (const path of allPaths) {
				list.createEl("div", { cls: "vi-file-list-item", text: path });
			}
		} else {
			contentEl.createEl("p", { text: this.actions[0].description });
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
