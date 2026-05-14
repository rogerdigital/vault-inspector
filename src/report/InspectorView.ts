import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";
import { renderSummary } from "./render-summary";
import { renderIssues } from "./render-issues";
import { setIcon } from "obsidian";

export const VIEW_TYPE_INSPECTOR = "vault-inspector";

export class InspectorView extends ItemView {
	private model: ReportModel = {
		result: null,
		isScanning: false,
		filterScanner: null,
		filterSeverity: null,
		showIgnored: false,
		enableFixActions: true,
		selectionMode: false,
		selectedFingerprints: new Set(),
	};

	private onIgnoreAllIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onRestoreIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onFixAllIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onRevealFile: ((path: string) => void | Promise<void>) | null = null;
	private onRunScan: (() => void) | null = null;

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
		this.onIgnoreAllIssues = null;
		this.onRestoreIssues = null;
		this.onFixAllIssues = null;
		this.onRevealFile = null;
		this.onRunScan = null;
	}

	setScanning(scanning: boolean) {
		this.model.isScanning = scanning;
		this.render();
	}

	setResult(result: ScanResult) {
		this.model.result = result;
		this.model.isScanning = false;
		this.model.selectionMode = false;
		this.model.selectedFingerprints = new Set();
		this.render();
	}

	setEnableFixActions(enabled: boolean) {
		this.model.enableFixActions = enabled;
	}

	setCallbacks(callbacks: {
		onIgnoreAllIssues: (issues: Issue[]) => void | Promise<void>;
		onRestoreIssues: (issues: Issue[]) => void | Promise<void>;
		onFixAllIssues: (issues: Issue[]) => void | Promise<void>;
		onRevealFile: (path: string) => void | Promise<void>;
		onRunScan: () => void;
	}) {
		this.onIgnoreAllIssues = callbacks.onIgnoreAllIssues;
		this.onRestoreIssues = callbacks.onRestoreIssues;
		this.onFixAllIssues = callbacks.onFixAllIssues;
		this.onRevealFile = callbacks.onRevealFile;
		this.onRunScan = callbacks.onRunScan;
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
				if (this.onRunScan) this.onRunScan();
			});
			empty.createEl("p", {
				cls: "vi-empty-hint",
				text: "You can also click the search icon in the left ribbon, or use the command palette (Cmd/Ctrl+P) → \"Vault Inspector: Run scan\".",
			});
			return;
		}

		this.renderToolbar(container);
		renderSummary(container, this.model.result, {
			onFilterSeverity: (severity) => {
				this.model.filterSeverity = this.model.filterSeverity === severity ? null : severity;
				this.render();
			},
		});

		if (this.model.selectionMode) {
			this.renderActionBar(container);
		}

		const issuesContainer = container.createDiv({ cls: "vi-issues" });
		renderIssues(issuesContainer, this.model.result, this.model, {
			onOpenFile: (path: string) => { void this.handleOpenFile(path); },
			onCopyPath: (path: string) => this.handleCopyPath(path),
			onToggleSelect: (issue: Issue) => this.handleToggleSelect(issue),
		});
	}

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "vi-toolbar" });
		this.renderScannerFilter(toolbar);
		this.renderSeverityFilter(toolbar);
		this.renderToggleIgnored(toolbar);

		const hasVisibleIssues = this.model.result && this.getVisibleIssues().length > 0;
		if (hasVisibleIssues) {
			const selectBtn = toolbar.createEl("button", {
				cls: `vi-filter-btn vi-select-btn ${this.model.selectionMode ? "vi-active" : ""}`,
				text: this.model.selectionMode ? "Selecting..." : "Select",
				attr: { "data-tooltip": "Enter selection mode" },
			});
			setIcon(selectBtn, "check-square");
			selectBtn.addEventListener("click", () => {
				this.model.selectionMode = !this.model.selectionMode;
				if (!this.model.selectionMode) this.model.selectedFingerprints = new Set();
				this.render();
			});
		}
	}

	private renderActionBar(container: HTMLElement) {
		if (!this.model.result) return;

		const visibleIssues = this.getVisibleIssues();
		const selectedIssues = visibleIssues.filter((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const ignoredFingerprints = new Set(this.model.result.ignoredIssues.map((i) => i.fingerprint));
		const selectedIgnored = selectedIssues.filter((i) => ignoredFingerprints.has(i.fingerprint));
		const selectedNonIgnored = selectedIssues.filter((i) => !ignoredFingerprints.has(i.fingerprint));
		const selectedFixable = selectedNonIgnored.filter((i) => i.fixAction);

		const bar = container.createDiv({ cls: "vi-action-bar" });
		const left = bar.createDiv({ cls: "vi-action-bar-left" });
		const right = bar.createDiv({ cls: "vi-action-bar-right" });

		const allSelected = visibleIssues.length > 0 && visibleIssues.every((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const toggleWrap = left.createEl("label", { cls: "vi-toggle-all", attr: { "data-tooltip": allSelected ? "Deselect all" : "Select all" } });
		const toggleAll = toggleWrap.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
		(toggleAll as HTMLInputElement).checked = allSelected;
		toggleWrap.addEventListener("click", (e) => {
			e.preventDefault();
			if (allSelected) {
				this.model.selectedFingerprints = new Set();
			} else {
				for (const issue of visibleIssues) this.model.selectedFingerprints.add(issue.fingerprint);
			}
			this.render();
		});

		if (this.model.enableFixActions && selectedFixable.length > 0) {
			const deleteBtn = right.createEl("button", {
				cls: "vi-action-btn vi-action-delete",
				text: `Delete (${selectedFixable.length})`,
				attr: { "data-tooltip": "Move selected files to trash" },
			});
			setIcon(deleteBtn, "trash-2");
			deleteBtn.addEventListener("click", () => {
				if (this.onFixAllIssues) void this.onFixAllIssues(selectedFixable);
			});
		}

		if (selectedNonIgnored.length > 0) {
			const ignoreBtn = right.createEl("button", {
				cls: "vi-action-btn vi-action-ignore",
				text: `Ignore (${selectedNonIgnored.length})`,
				attr: { "data-tooltip": "Hide selected issues from future scans" },
			});
			setIcon(ignoreBtn, "eye-off");
			ignoreBtn.addEventListener("click", () => {
				if (this.onIgnoreAllIssues) void this.onIgnoreAllIssues(selectedNonIgnored);
			});
		}

		if (selectedIgnored.length > 0) {
			const restoreBtn = right.createEl("button", {
				cls: "vi-action-btn",
				text: `Restore (${selectedIgnored.length})`,
				attr: { "data-tooltip": "Stop ignoring selected issues" },
			});
			setIcon(restoreBtn, "eye");
			restoreBtn.addEventListener("click", () => {
				if (this.onRestoreIssues) void this.onRestoreIssues(selectedIgnored);
			});
		}

		const cancelBtn = right.createEl("button", { cls: "vi-action-btn", text: "Cancel", attr: { "data-tooltip": "Exit selection mode" } });
		setIcon(cancelBtn, "x");
		cancelBtn.addEventListener("click", () => {
			this.model.selectionMode = false;
			this.model.selectedFingerprints = new Set();
			this.render();
		});
	}

	private getVisibleIssues(): Issue[] {
		if (!this.model.result) return [];
		let issues: Issue[] = this.model.result.issues;
		if (this.model.showIgnored) issues = [...issues, ...this.model.result.ignoredIssues];
		if (this.model.filterSeverity) issues = issues.filter((i) => i.severity === this.model.filterSeverity);
		if (this.model.filterScanner) issues = issues.filter((i) => i.scannerId === this.model.filterScanner);
		return issues;
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
			cls: `vi-filter-btn vi-toggle-ignored ${this.model.showIgnored ? "vi-active" : ""}`,
			text: this.model.showIgnored ? "Hide ignored" : "Show ignored",
			attr: { "data-tooltip": "Toggle display of ignored issues" },
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
		void navigator.clipboard.writeText(path);
		new Notice(`Copied: ${path}`);
	}

	private handleToggleSelect(issue: Issue) {
		if (this.model.selectedFingerprints.has(issue.fingerprint)) {
			this.model.selectedFingerprints.delete(issue.fingerprint);
		} else {
			this.model.selectedFingerprints.add(issue.fingerprint);
		}
		this.render();
	}
}
