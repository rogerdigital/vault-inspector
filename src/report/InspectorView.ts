import { ItemView, WorkspaceLeaf, Notice, TFile, setTooltip } from "obsidian";
import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";
import { renderSummary } from "./render-summary";
import { renderIssueList } from "./render-issues";
import { setIcon } from "obsidian";

export const VIEW_TYPE_INSPECTOR = "vault-inspector";

export class InspectorView extends ItemView {
	private model: ReportModel = {
		result: null,
		isScanning: false,
		filterScanner: null,
		filterSeverity: null,
		enableFixActions: true,
		selectionMode: false,
		selectedFingerprints: new Set(),
		ignoredExpanded: false,
		ignoredSelectionMode: false,
		ignoredSelectedFingerprints: new Set(),
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
		this.model.ignoredSelectionMode = false;
		this.model.ignoredSelectedFingerprints = new Set();
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

	// ─── Render ──────────────────────────────────────────────

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
			this.renderMainActionBar(container);
		}

		const issuesContainer = container.createDiv({ cls: "vi-issues" });
		const visibleIssues = this.getVisibleIssues();
		renderIssueList(issuesContainer, {
			issues: visibleIssues,
			scannersRun: this.model.result.scannersRun,
			selectionMode: this.model.selectionMode,
			selectedFingerprints: this.model.selectedFingerprints,
			onOpenFile: (path) => { void this.handleOpenFile(path); },
			onCopyPath: (path) => this.handleCopyPath(path),
			onToggleSelect: (issue) => this.handleToggleSelect(issue),
		});

		this.renderIgnoredSection(container);
	}

	// ─── Toolbar ─────────────────────────────────────────────

	private renderToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "vi-toolbar" });
		this.renderScannerFilter(toolbar);
		this.renderSeverityFilter(toolbar);

		const visibleIssues = this.getVisibleIssues();
		if (visibleIssues.length > 0) {
			const selectBtn = toolbar.createEl("button", {
				cls: `vi-filter-btn vi-select-btn ${this.model.selectionMode ? "vi-active" : ""}`,
				text: this.model.selectionMode ? "Done" : "Select",
			});
			setTooltip(selectBtn, this.model.selectionMode ? "Exit selection mode" : "Enter selection mode");
			selectBtn.addEventListener("click", () => {
				this.model.selectionMode = !this.model.selectionMode;
				if (!this.model.selectionMode) this.model.selectedFingerprints = new Set();
				this.render();
			});
		}
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

	// ─── Main Action Bar ─────────────────────────────────────

	private renderMainActionBar(container: HTMLElement) {
		if (!this.model.result) return;

		const visibleIssues = this.getVisibleIssues();
		const selectedIssues = visibleIssues.filter((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const selectedFixable = selectedIssues.filter((i) => i.fixAction);

		const bar = container.createDiv({ cls: "vi-action-bar" });
		const left = bar.createDiv({ cls: "vi-action-bar-left" });
		const right = bar.createDiv({ cls: "vi-action-bar-right" });

		const allSelected = visibleIssues.length > 0 && visibleIssues.every((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const toggleAll = left.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
		(toggleAll as HTMLInputElement).checked = allSelected;
		setTooltip(toggleAll, allSelected ? "Deselect all" : "Select all");
		toggleAll.addEventListener("click", () => {
			if (allSelected) {
				this.model.selectedFingerprints = new Set();
			} else {
				for (const issue of visibleIssues) this.model.selectedFingerprints.add(issue.fingerprint);
			}
			this.render();
		});

		if (this.model.enableFixActions && selectedFixable.length > 0) {
			const deleteBtn = right.createEl("button", { cls: "vi-action-btn vi-action-delete" });
			setIcon(deleteBtn, "trash-2");
			deleteBtn.createEl("span", { text: `(${selectedFixable.length})` });
			setTooltip(deleteBtn, "Move selected files to trash");
			deleteBtn.addEventListener("click", () => {
				if (this.onFixAllIssues) void this.onFixAllIssues(selectedFixable);
			});
		}

		if (selectedIssues.length > 0) {
			const ignoreBtn = right.createEl("button", { cls: "vi-action-btn vi-action-ignore" });
			setIcon(ignoreBtn, "eye-off");
			ignoreBtn.createEl("span", { text: `(${selectedIssues.length})` });
			setTooltip(ignoreBtn, "Hide selected issues from future scans");
			ignoreBtn.addEventListener("click", () => {
				if (this.onIgnoreAllIssues) void this.onIgnoreAllIssues(selectedIssues);
			});
		}

		const cancelBtn = right.createEl("button", { cls: "vi-action-btn" });
		setIcon(cancelBtn, "x");
		setTooltip(cancelBtn, "Exit selection mode");
		cancelBtn.addEventListener("click", () => {
			this.model.selectionMode = false;
			this.model.selectedFingerprints = new Set();
			this.render();
		});
	}

	// ─── Ignored Section ─────────────────────────────────────

	private renderIgnoredSection(container: HTMLElement) {
		if (!this.model.result) return;
		const ignoredIssues = this.model.result.ignoredIssues;
		if (ignoredIssues.length === 0) return;

		const section = container.createDiv({ cls: "vi-ignored-section" });

		const header = section.createDiv({ cls: "vi-ignored-header" });
		const headerLeft = header.createDiv({ cls: "vi-ignored-header-left" });
		const chevron = headerLeft.createEl("span", { cls: "vi-ignored-chevron" });
		setIcon(chevron, this.model.ignoredExpanded ? "chevron-down" : "chevron-right");
		headerLeft.createEl("span", { text: `Ignored items (${ignoredIssues.length})` });
		headerLeft.addEventListener("click", () => {
			this.model.ignoredExpanded = !this.model.ignoredExpanded;
			if (!this.model.ignoredExpanded) {
				this.model.ignoredSelectionMode = false;
				this.model.ignoredSelectedFingerprints = new Set();
			}
			this.render();
		});

		if (this.model.ignoredExpanded) {
			const selectBtn = header.createEl("button", {
				cls: `vi-filter-btn vi-select-btn ${this.model.ignoredSelectionMode ? "vi-active" : ""}`,
				text: this.model.ignoredSelectionMode ? "Done" : "Select",
			});
			setTooltip(selectBtn, this.model.ignoredSelectionMode ? "Exit selection mode" : "Select to restore");
			selectBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.model.ignoredSelectionMode = !this.model.ignoredSelectionMode;
				if (!this.model.ignoredSelectionMode) this.model.ignoredSelectedFingerprints = new Set();
				this.render();
			});
		}

		if (!this.model.ignoredExpanded) return;

		const body = section.createDiv({ cls: "vi-ignored-body" });

		if (this.model.ignoredSelectionMode) {
			this.renderIgnoredActionBar(body, ignoredIssues);
		}

		const listContainer = body.createDiv({ cls: "vi-ignored-list" });
		renderIssueList(listContainer, {
			issues: ignoredIssues,
			scannersRun: this.model.result.scannersRun,
			selectionMode: this.model.ignoredSelectionMode,
			selectedFingerprints: this.model.ignoredSelectedFingerprints,
			onOpenFile: (path) => { void this.handleOpenFile(path); },
			onCopyPath: (path) => this.handleCopyPath(path),
			onToggleSelect: (issue) => this.handleIgnoredToggleSelect(issue),
		});
	}

	private renderIgnoredActionBar(container: HTMLElement, ignoredIssues: Issue[]) {
		const selectedIssues = ignoredIssues.filter((i) => this.model.ignoredSelectedFingerprints.has(i.fingerprint));

		const bar = container.createDiv({ cls: "vi-action-bar" });
		const left = bar.createDiv({ cls: "vi-action-bar-left" });
		const right = bar.createDiv({ cls: "vi-action-bar-right" });

		const allSelected = ignoredIssues.length > 0 && ignoredIssues.every((i) => this.model.ignoredSelectedFingerprints.has(i.fingerprint));
		const toggleAll = left.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
		(toggleAll as HTMLInputElement).checked = allSelected;
		setTooltip(toggleAll, allSelected ? "Deselect all" : "Select all");
		toggleAll.addEventListener("click", () => {
			if (allSelected) {
				this.model.ignoredSelectedFingerprints = new Set();
			} else {
				for (const issue of ignoredIssues) this.model.ignoredSelectedFingerprints.add(issue.fingerprint);
			}
			this.render();
		});

		if (selectedIssues.length > 0) {
			const restoreBtn = right.createEl("button", { cls: "vi-action-btn" });
			setIcon(restoreBtn, "eye");
			restoreBtn.createEl("span", { text: `(${selectedIssues.length})` });
			setTooltip(restoreBtn, "Stop ignoring selected issues");
			restoreBtn.addEventListener("click", () => {
				if (this.onRestoreIssues) void this.onRestoreIssues(selectedIssues);
			});
		}

		const cancelBtn = right.createEl("button", { cls: "vi-action-btn" });
		setIcon(cancelBtn, "x");
		setTooltip(cancelBtn, "Exit selection mode");
		cancelBtn.addEventListener("click", () => {
			this.model.ignoredSelectionMode = false;
			this.model.ignoredSelectedFingerprints = new Set();
			this.render();
		});
	}

	// ─── Helpers ─────────────────────────────────────────────

	private getVisibleIssues(): Issue[] {
		if (!this.model.result) return [];
		let issues = this.model.result.issues;
		if (this.model.filterSeverity) issues = issues.filter((i) => i.severity === this.model.filterSeverity);
		if (this.model.filterScanner) issues = issues.filter((i) => i.scannerId === this.model.filterScanner);
		return issues;
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

	private handleIgnoredToggleSelect(issue: Issue) {
		if (this.model.ignoredSelectedFingerprints.has(issue.fingerprint)) {
			this.model.ignoredSelectedFingerprints.delete(issue.fingerprint);
		} else {
			this.model.ignoredSelectedFingerprints.add(issue.fingerprint);
		}
		this.render();
	}
}
