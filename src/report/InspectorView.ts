import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";
import { renderSummary } from "./render-summary";
import { renderIssues } from "./render-issues";

export const VIEW_TYPE_INSPECTOR = "vault-inspector";

export class InspectorView extends ItemView {
	private model: ReportModel = {
		result: null,
		isScanning: false,
		filterScanner: null,
		filterSeverity: null,
		showIgnored: false,
	};

	private onIgnoreIssue: ((issue: Issue) => void | Promise<void>) | null = null;
	private onRevealFile: ((path: string) => void | Promise<void>) | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_INSPECTOR; }
	getDisplayText(): string { return "Vault inspector"; }
	getIcon(): string { return "shield-check"; }

	async onOpen() {
		await Promise.resolve();
		const container = this.containerEl.children[1];
		container.empty();
		container.classList.add("vault-inspector");
		this.render();
	}

	async onClose() {
		await Promise.resolve();
		this.onIgnoreIssue = null;
		this.onRevealFile = null;
	}

	setScanning(scanning: boolean) {
		this.model.isScanning = scanning;
		this.render();
	}

	setResult(result: ScanResult) {
		this.model.result = result;
		this.model.isScanning = false;
		this.render();
	}

	setCallbacks(callbacks: {
		onIgnoreIssue: (issue: Issue) => void | Promise<void>;
		onRevealFile: (path: string) => void | Promise<void>;
	}) {
		this.onIgnoreIssue = callbacks.onIgnoreIssue;
		this.onRevealFile = callbacks.onRevealFile;
	}

	hasResult(): boolean { return this.model.result !== null; }
	getResult(): ScanResult | null { return this.model.result; }

	private render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		if (this.model.isScanning) {
			container.createEl("div", { cls: "vi-progress", text: "Scanning vault..." });
			return;
		}

		if (!this.model.result) {
			const empty = container.createDiv({ cls: "vi-empty" });
			empty.createEl("p", { text: "No scan results yet." });
			const btn = empty.createEl("button", { cls: "vi-empty-btn", text: "Run scan now" });
			btn.addEventListener("click", () => {
				this.onRevealFile = null;
				this.onIgnoreIssue = null;
				this.setScanning(true);
			});
			empty.createEl("p", {
				cls: "vi-empty-hint",
				text: "You can also click the search icon in the left ribbon, or use the command palette (Cmd/Ctrl+P) → \"Vault Inspector: Run scan\".",
			});
			return;
		}

		this.renderToolbar(container);
		renderSummary(container, this.model.result);

		const issuesContainer = container.createDiv({ cls: "vi-issues" });
		renderIssues(issuesContainer, this.model.result, this.model, {
			onOpenFile: (path: string) => { void this.handleOpenFile(path); },
			onCopyPath: (path: string) => this.handleCopyPath(path),
			onIgnore: (issue: Issue) => this.handleIgnore(issue),
		});
	}

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "vi-toolbar" });
		this.renderScannerFilter(toolbar);
		this.renderSeverityFilter(toolbar);
		this.renderToggleIgnored(toolbar);
	}

	private renderScannerFilter(toolbar: HTMLElement) {
		if (!this.model.result) return;
		const group = toolbar.createDiv({ cls: "vi-filter-group" });
		group.createEl("button", {
			cls: `vi-filter-btn ${this.model.filterScanner === null ? "vi-active" : ""}`,
			text: "All",
		}).addEventListener("click", () => { this.model.filterScanner = null; this.render(); });

		for (const scannerId of this.model.result.scannersRun) {
			const count = this.model.result.issues.filter((i) => i.scannerId === scannerId).length;
			group.createEl("button", {
				cls: `vi-filter-btn ${this.model.filterScanner === scannerId ? "vi-active" : ""}`,
				text: `${SCANNER_LABELS[scannerId]} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterScanner = this.model.filterScanner === scannerId ? null : scannerId;
				this.render();
			});
		}
	}

	private renderSeverityFilter(toolbar: HTMLElement) {
		if (!this.model.result) return;
		const group = toolbar.createDiv({ cls: "vi-filter-group" });
		for (const sev of ["error", "warning", "info"] as const) {
			const count = this.model.result.issues.filter((i) => i.severity === sev).length;
			if (count === 0) continue;
			group.createEl("button", {
				cls: `vi-filter-btn vi-severity-${sev} ${this.model.filterSeverity === sev ? "vi-active" : ""}`,
				text: `${sev} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterSeverity = this.model.filterSeverity === sev ? null : sev;
				this.render();
			});
		}
	}

	private renderToggleIgnored(toolbar: HTMLElement) {
		toolbar.createEl("button", {
			cls: `vi-filter-btn ${this.model.showIgnored ? "vi-active" : ""}`,
			text: this.model.showIgnored ? "Hide ignored" : "Show ignored",
		}).addEventListener("click", () => {
			this.model.showIgnored = !this.model.showIgnored;
			this.render();
		});
	}

	private async handleOpenFile(path: string) {
		if (this.onRevealFile) { void this.onRevealFile(path); return; }
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
	}

	private handleCopyPath(path: string) {
		navigator.clipboard.writeText(path);
		new Notice(`Copied: ${path}`);
	}

	private handleIgnore(issue: Issue) {
		if (this.onIgnoreIssue) void this.onIgnoreIssue(issue);
	}
}
