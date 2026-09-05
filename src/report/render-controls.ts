import type { ScanResult } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { IssueFilterView, IssueFilters } from "./report-model";
import { presentClassification, presentLifecycle, presentSeverity } from "./presentation";

export type ReportControlsConfig = {
	result: ScanResult;
	filterView: IssueFilterView;
	filters: IssueFilters;
	comparisonAvailable: boolean;
	expanded: boolean;
	selectionMode: boolean;
	onExpandedChange: (expanded: boolean) => void;
	onFiltersChange: (filters: IssueFilters) => void;
	onSelectionModeChange: (selectionMode: boolean) => void;
};

export function activeFilterCount(filters: IssueFilters): number {
	return [
		filters.scanner,
		filters.severity,
		filters.status,
		filters.classification,
	].filter((value) => value !== null).length;
}

export function renderReportControls(
	container: HTMLElement,
	config: ReportControlsConfig,
): HTMLDetailsElement {
	const active = activeFilterCount(config.filters);
	const details = container.createEl("details", {
		cls: "vi-controls-disclosure",
	});
	details.open = config.expanded || active > 0 || config.selectionMode;
	details.addEventListener("toggle", () => {
		config.onExpandedChange(details.open);
	});
	const summary = details.createEl("summary", {
		text: active > 0
			? `Filter and select · ${active} active`
			: "Filter and select",
	});
	summary.setAttr("aria-label", active > 0
		? `Filter and select, ${active} active filters`
		: "Filter and select");

	const body = details.createDiv({ cls: "vi-controls-body" });
	const update = (patch: Partial<IssueFilters>) => {
		config.onFiltersChange({ ...config.filters, ...patch });
	};

	const scanners = body.createDiv({ cls: "vi-filter-group" });
	createFilterButton(scanners, "All scanners", config.filters.scanner === null, () => {
		update({ scanner: null });
	});
	for (const scannerId of config.result.scannersRun) {
		const count = config.filterView.scannerCounts.get(scannerId) ?? 0;
		createFilterButton(
			scanners,
			`${SCANNER_LABELS[scannerId]} (${count})`,
			config.filters.scanner === scannerId,
			() => update({
				scanner: config.filters.scanner === scannerId ? null : scannerId,
			}),
		);
	}

	const severities = body.createDiv({ cls: "vi-filter-group" });
	for (const { severity, count } of config.filterView.severityFacets) {
		createFilterButton(
			severities,
			`${presentSeverity(severity)} (${count})`,
			config.filters.severity === severity,
			() => update({
				severity: config.filters.severity === severity ? null : severity,
			}),
		);
	}

	if (config.comparisonAvailable) {
		const lifecycle = body.createDiv({ cls: "vi-filter-group" });
		for (const { status, count } of config.filterView.statusFacets) {
			createFilterButton(
				lifecycle,
				`${presentLifecycle(status).label} (${count})`,
				config.filters.status === status,
				() => update({
					status: config.filters.status === status ? null : status,
				}),
			);
		}
	}

	const classifications = body.createDiv({ cls: "vi-filter-group" });
	for (const { classification, count } of config.filterView.classificationFacets) {
		createFilterButton(
			classifications,
			`${presentClassification(classification).label} (${count})`,
			config.filters.classification === classification,
			() => update({
				classification: config.filters.classification === classification
					? null
					: classification,
			}),
		);
	}

	const actions = body.createDiv({ cls: "vi-controls-actions" });
	const select = actions.createEl("button", {
		cls: `vi-filter-btn${config.selectionMode ? " vi-active" : ""}`,
		text: config.selectionMode ? "Done selecting" : "Select findings",
		attr: { type: "button" },
	});
	select.addEventListener("click", () => {
		config.onSelectionModeChange(!config.selectionMode);
	});
	if (active > 0) {
		const clear = actions.createEl("button", {
			cls: "vi-filter-btn",
			text: "Clear filters",
			attr: { type: "button" },
		});
		clear.addEventListener("click", () => {
			config.onFiltersChange({
				scanner: null,
				severity: null,
				status: null,
				classification: null,
			});
		});
	}
	return details;
}

function createFilterButton(
	container: HTMLElement,
	text: string,
	active: boolean,
	onClick: () => void,
): void {
	const button = container.createEl("button", {
		cls: `vi-filter-btn${active ? " vi-active" : ""}`,
		text,
		attr: { type: "button", "aria-pressed": String(active) },
	});
	button.addEventListener("click", onClick);
}
