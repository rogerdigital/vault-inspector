import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ScanResult } from "../scanner/Issue";
import { renderSummary } from "./render-summary";
import { renderIssues } from "./render-issues";

export const VIEW_TYPE_INSPECTOR = "vault-inspector";

export class InspectorView extends ItemView {
	private result: ScanResult | null = null;
	private isScanning = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_INSPECTOR; }
	getDisplayText(): string { return "Vault Inspector"; }
	getIcon(): string { return "search"; }

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.classList.add("vault-inspector");
		this.render();
	}

	async onClose() {}

	setScanning(scanning: boolean) {
		this.isScanning = scanning;
		this.render();
	}

	setResult(result: ScanResult) {
		this.result = result;
		this.isScanning = false;
		this.render();
	}

	private render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		if (this.isScanning) {
			container.createEl("div", { cls: "vi-progress", text: "Scanning vault..." });
			return;
		}

		if (!this.result) {
			container.createEl("div", {
				cls: "vi-empty",
				text: 'Run "Vault Inspector: Run scan" to check your vault.',
			});
			return;
		}

		renderSummary(container, this.result);
		const issuesContainer = container.createDiv({ cls: "vi-issues" });
		renderIssues(issuesContainer, this.result);
	}
}
