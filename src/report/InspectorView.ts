import { ItemView, MarkdownView, WorkspaceLeaf, TFile, setTooltip } from "obsidian";
import type { ScanProgress, ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import {
	buildIssueFilterView,
	type IssueFilterView,
	type ReportModel,
} from "./report-model";
import { renderSummary } from "./render-summary";
import { renderIssueList } from "./render-issues";
import { setIcon } from "obsidian";
import { formatDuration } from "../utils/format";
import { describeFixActions } from "../fix/confirm-modal";
import type { LifecycleComparison } from "../scanner/result-diff";

export const VIEW_TYPE_INSPECTOR = "vault-inspector";

function getLocationTargets(issue: Issue): string[] {
	const url = issue.evidence.url;
	if (typeof url === "string") return [url];
	const link = issue.evidence.link;
	if (typeof link === "string") return [link];
	const target = issue.evidence.target;
	if (typeof target === "string") return [target];
	const property = issue.evidence.property;
	if (typeof property === "string") return [property];
	const tag = issue.evidence.tag;
	if (typeof tag === "string") return [`#${tag}`, tag];
	return [];
}

function findFirstTextPosition(content: string, targets: string[]): { line: number; ch: number } | null {
	for (const target of targets) {
		const position = findTextPosition(content, target);
		if (position) return position;
	}
	return null;
}

function findTextPosition(content: string, target: string): { line: number; ch: number } | null {
	const index = content.indexOf(target);
	if (index === -1) return null;
	const before = content.slice(0, index);
	const lines = before.split(/\n/);
	return {
		line: lines.length - 1,
		ch: lines[lines.length - 1].length,
	};
}

export class InspectorView extends ItemView {
	private model: ReportModel = {
		result: null,
		comparison: {
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		},
		isScanning: false,
		scanProgress: null,
		scanStartedAt: null,
		filterScanner: null,
		filterSeverity: null,
		filterStatus: null,
		filterClassification: null,
		enableFixActions: true,
		selectionMode: false,
		selectedFingerprints: new Set(),
		ignoredExpanded: false,
		resolvedExpanded: false,
		ignoredSelectionMode: false,
		ignoredSelectedFingerprints: new Set(),
	};

	private onIgnoreAllIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onRestoreIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onFixAllIssues: ((issues: Issue[]) => void | Promise<void>) | null = null;
	private onRevealIssue: ((issue: Issue) => void | Promise<void>) | null = null;
	private onRunScan: (() => void) | null = null;
	private backToTopHandler: (() => void) | null = null;
	private scanTimer: number | null = null;

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
		if (this.backToTopHandler) {
			const container = this.containerEl.children[1] as HTMLElement;
			container.removeEventListener("scroll", this.backToTopHandler);
			this.backToTopHandler = null;
		}
		this.stopScanTimer();
		this.onIgnoreAllIssues = null;
		this.onRestoreIssues = null;
		this.onFixAllIssues = null;
		this.onRevealIssue = null;
		this.onRunScan = null;
	}

	setScanning(scanning: boolean) {
		this.model.isScanning = scanning;
		if (scanning) {
			this.model.scanStartedAt = Date.now();
			this.model.scanProgress = null;
			this.startScanTimer();
		} else {
			this.model.scanProgress = null;
			this.model.scanStartedAt = null;
			this.stopScanTimer();
		}
		this.render();
	}

	setScanProgress(progress: ScanProgress) {
		this.model.scanProgress = progress;
		this.render();
	}

	setResult(result: ScanResult, comparison: LifecycleComparison) {
		this.model.result = result;
		this.model.comparison = comparison;
		if (
			this.model.filterStatus
			&& (
				!comparison.available
				|| !result.issues.some((issue) =>
					comparison.statuses.get(issue.fingerprint) === this.model.filterStatus)
			)
		) {
			this.model.filterStatus = null;
		}
		if (
			this.model.filterClassification
			&& !result.issues.some(
				(issue) => issue.classification === this.model.filterClassification,
			)
		) {
			this.model.filterClassification = null;
		}
		this.model.isScanning = false;
		this.model.scanProgress = null;
		this.model.scanStartedAt = null;
		this.stopScanTimer();
		this.model.selectionMode = false;
		this.model.selectedFingerprints = new Set();
		this.model.ignoredSelectionMode = false;
		this.model.ignoredSelectedFingerprints = new Set();
		this.model.resolvedExpanded = false;
		this.render();
	}

	setEnableFixActions(enabled: boolean) {
		this.model.enableFixActions = enabled;
	}

	setCallbacks(callbacks: {
		onIgnoreAllIssues: (issues: Issue[]) => void | Promise<void>;
		onRestoreIssues: (issues: Issue[]) => void | Promise<void>;
		onFixAllIssues: (issues: Issue[]) => void | Promise<void>;
		onRevealIssue: (issue: Issue) => void | Promise<void>;
		onRunScan: () => void;
	}) {
		this.onIgnoreAllIssues = callbacks.onIgnoreAllIssues;
		this.onRestoreIssues = callbacks.onRestoreIssues;
		this.onFixAllIssues = callbacks.onFixAllIssues;
		this.onRevealIssue = callbacks.onRevealIssue;
		this.onRunScan = callbacks.onRunScan;
	}

	hasResult(): boolean { return this.model.result !== null; }
	getResult(): ScanResult | null { return this.model.result; }

	// ─── Render ──────────────────────────────────────────────

	private render() {
		const container = this.containerEl.children[1] as HTMLElement;
		if (this.backToTopHandler) {
			container.removeEventListener("scroll", this.backToTopHandler);
			this.backToTopHandler = null;
		}
		container.empty();

		if (this.model.isScanning) {
			this.renderProgress(container);
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
				text: "You can also click the shield icon in the left ribbon, or run \"vault inspector: Run scan\" from the command palette.",
			});
			return;
		}

		const filterView = this.getIssueFilterView();
		this.renderToolbar(container, filterView);
		renderSummary(container, this.model.result, {
			comparison: this.model.comparison,
			onFilterStatus: (status) => {
				this.model.filterStatus = this.model.filterStatus === status ? null : status;
				this.render();
			},
		});

		if (this.model.selectionMode) {
			this.renderMainActionBar(container);
		}

		const issuesContainer = container.createDiv({ cls: "vi-issues" });
		renderIssueList(issuesContainer, {
			issues: filterView.visibleIssues,
			scannersRun: this.model.result.scannersRun,
			selectionMode: this.model.selectionMode,
			selectedFingerprints: this.model.selectedFingerprints,
			statuses: this.model.comparison.statuses,
			onOpenIssue: (issue) => { void this.handleOpenIssue(issue); },
			onToggleSelect: (issue) => this.handleToggleSelect(issue),
		});

		this.renderIgnoredSection(container);
		this.addBackToTop(container);
	}

	private renderProgress(container: HTMLElement) {
		const progress = this.model.scanProgress;
		const startedAt = this.model.scanStartedAt ?? Date.now();
		const elapsedMs = Date.now() - startedAt;
		const scannerIndex = progress?.scannerIndex ?? 0;
		const scannerTotal = progress?.scannerTotal ?? 0;
		const percent = scannerTotal > 0
			? Math.max(0, Math.min(100, Math.round((scannerIndex / scannerTotal) * 100)))
			: 0;

		const panel = container.createDiv({ cls: "vi-progress-panel" });
		panel.createEl("h2", { text: "Scanning vault" });

		const bar = panel.createDiv({ cls: "vi-progress-bar", attr: { "aria-label": "Scan progress" } });
		bar.createDiv({ cls: "vi-progress-bar-fill", attr: { style: `width: ${percent}%` } });

		panel.createDiv({
			cls: "vi-progress-meta",
			text: scannerTotal > 0 ? `${scannerIndex} / ${scannerTotal} scanners` : "Preparing scan...",
		});

		const current = panel.createDiv({ cls: "vi-progress-current" });
		const scannerLabel = progress ? SCANNER_LABELS[progress.scannerId] : "Preparing scan";
		current.createDiv({ cls: "vi-progress-label", text: "Current" });
		current.createDiv({ cls: "vi-progress-value", text: scannerLabel });

		const detailText = this.formatProgressDetail(progress);
		if (detailText) {
			const detail = panel.createDiv({ cls: "vi-progress-detail" });
			detail.createSpan({ text: detailText });
		}

		panel.createDiv({
			cls: "vi-progress-elapsed",
			text: `Elapsed: ${formatDuration(elapsedMs)}`,
		});
	}

	private formatProgressDetail(progress: ScanProgress | null): string {
		if (!progress) return "";
		if (progress.type === "scanner-skipped") {
			return progress.message ? `Skipped: ${progress.message}` : "Skipped";
		}
		if (progress.type === "scanner-complete") return "Completed";

		const parts: string[] = [];
		if (progress.phase) {
			if (typeof progress.current === "number" && typeof progress.total === "number") {
				parts.push(`${progress.phase}: ${progress.current} / ${progress.total}`);
			} else {
				parts.push(progress.phase);
			}
		} else if (progress.type === "scanner-start") {
			parts.push("Scanning...");
		}
		if (progress.message) parts.push(progress.message);
		return parts.join(" · ");
	}

	private startScanTimer() {
		if (this.scanTimer) return;
		this.scanTimer = window.setInterval(() => {
			if (this.model.isScanning) this.render();
		}, 1000);
	}

	private stopScanTimer() {
		if (!this.scanTimer) return;
		window.clearInterval(this.scanTimer);
		this.scanTimer = null;
	}

	// ─── Toolbar ─────────────────────────────────────────────

	private renderToolbar(container: HTMLElement, filterView: IssueFilterView) {
		const toolbar = container.createDiv({ cls: "vi-toolbar" });
		this.renderScannerFilter(toolbar, filterView);
		this.renderSeverityFilter(toolbar, filterView);
		if (this.model.comparison.available) {
			this.renderLifecycleFilter(toolbar, filterView);
		}
		if ((this.model.result?.issues.length ?? 0) > 0) {
			this.renderClassificationFilter(toolbar, filterView);
		}

		if (filterView.visibleIssues.length > 0) {
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

	private renderScannerFilter(toolbar: HTMLElement, filterView: IssueFilterView) {
		if (!this.model.result) return;
		const group = toolbar.createDiv({ cls: "vi-filter-group" });
		group.createEl("button", {
			cls: `vi-filter-btn ${this.model.filterScanner === null ? "vi-active" : ""}`,
			text: "All",
		}).addEventListener("click", () => { this.model.filterScanner = null; this.render(); });

		for (const scannerId of this.model.result.scannersRun) {
			const count = filterView.scannerCounts.get(scannerId) ?? 0;
			group.createEl("button", {
				cls: `vi-filter-btn ${this.model.filterScanner === scannerId ? "vi-active" : ""}`,
				text: `${SCANNER_LABELS[scannerId]} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterScanner = this.model.filterScanner === scannerId ? null : scannerId;
				this.render();
			});
		}
	}

	private renderSeverityFilter(toolbar: HTMLElement, filterView: IssueFilterView) {
		if (!this.model.result) return;
		const group = toolbar.createDiv({ cls: "vi-filter-group" });
		for (const { severity, count } of filterView.severityFacets) {
			group.createEl("button", {
				cls: `vi-filter-btn vi-severity-${severity} ${this.model.filterSeverity === severity ? "vi-active" : ""}`,
				text: `${severity} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterSeverity = this.model.filterSeverity === severity ? null : severity;
				this.render();
			});
		}
	}

	private renderLifecycleFilter(toolbar: HTMLElement, filterView: IssueFilterView) {
		const group = toolbar.createDiv({ cls: "vi-filter-group vi-lifecycle-filter" });
		for (const { status, count } of filterView.statusFacets) {
			group.createEl("button", {
				cls: `vi-filter-btn ${this.model.filterStatus === status ? "vi-active" : ""}`,
				text: `${status} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterStatus = this.model.filterStatus === status ? null : status;
				this.render();
			});
		}
	}

	private renderClassificationFilter(toolbar: HTMLElement, filterView: IssueFilterView) {
		const group = toolbar.createDiv({ cls: "vi-filter-group vi-classification-filter" });
		for (const { classification, count } of filterView.classificationFacets) {
			group.createEl("button", {
				cls: `vi-filter-btn ${this.model.filterClassification === classification ? "vi-active" : ""}`,
				text: `${classification} (${count})`,
			}).addEventListener("click", () => {
				this.model.filterClassification = this.model.filterClassification === classification
					? null
					: classification;
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
		toggleAll.checked = allSelected;
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
			const fixBtn = right.createEl("button", { cls: "vi-action-btn vi-action-delete" });
			const actionKinds = new Set(selectedFixable.map((issue) => issue.fixAction!.kind));
			setIcon(
				fixBtn,
				actionKinds.size > 1
					? "wrench"
					: actionKinds.has("remove-link-text") ? "pencil" : "trash-2",
			);
			fixBtn.createSpan({ text: `(${selectedFixable.length})` });
			setTooltip(
				fixBtn,
				describeFixActions(selectedFixable.map((issue) => issue.fixAction!)),
			);
			fixBtn.addEventListener("click", () => {
				if (this.onFixAllIssues) void this.onFixAllIssues(selectedFixable);
			});
		}

		if (selectedIssues.length > 0) {
			const ignoreBtn = right.createEl("button", { cls: "vi-action-btn vi-action-ignore" });
			setIcon(ignoreBtn, "eye-off");
			ignoreBtn.createSpan({ text: `(${selectedIssues.length})` });
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
		const chevron = headerLeft.createSpan({ cls: "vi-ignored-chevron" });
		setIcon(chevron, this.model.ignoredExpanded ? "chevron-down" : "chevron-right");
		headerLeft.createSpan({ text: `Ignored items (${ignoredIssues.length})` });
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
			statuses: this.model.comparison.statuses,
			onOpenIssue: (issue) => { void this.handleOpenIssue(issue); },
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
		toggleAll.checked = allSelected;
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
			restoreBtn.createSpan({ text: `(${selectedIssues.length})` });
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

	private addBackToTop(container: HTMLElement) {
		const anchor = container.createDiv({ cls: "vi-back-to-top-anchor" });
		const btn = anchor.createEl("button", { cls: "vi-back-to-top" });
		setIcon(btn, "arrow-up");
		setTooltip(btn, "Back to top");
		btn.addEventListener("click", () => {
			container.scrollTo({ top: 0, behavior: "smooth" });
		});
		const updateVisibility = () => {
			btn.style.display = container.scrollTop > 200 ? "" : "none";
		};
		container.addEventListener("scroll", updateVisibility);
		this.backToTopHandler = updateVisibility;
		updateVisibility();
	}

	private getVisibleIssues(): Issue[] {
		return this.getIssueFilterView().visibleIssues;
	}

	private getIssueFilterView(): IssueFilterView {
		return buildIssueFilterView(this.model.result?.issues ?? [], {
			scanner: this.model.filterScanner,
			severity: this.model.filterSeverity,
			status: this.model.filterStatus,
			classification: this.model.filterClassification,
		}, this.model.comparison.statuses);
	}

	private async handleOpenIssue(issue: Issue) {
		if (this.onRevealIssue) { void this.onRevealIssue(issue); return; }
		await this.revealIssue(issue);
	}

	async revealIssue(issue: Issue) {
		const path = issue.primaryPath ?? issue.relatedPaths[0];
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { active: true });

		const targets = getLocationTargets(issue);
		if (targets.length === 0) return;

		const content = await this.app.vault.cachedRead(file);
		const position = findFirstTextPosition(content, targets);
		if (!position) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor;
		if (!editor) return;

		editor.setCursor(position);
		editor.scrollIntoView({ from: position, to: position }, true);
		editor.focus();
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
