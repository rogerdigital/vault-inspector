import { App, Modal } from "obsidian";
import { createSingleUseResolver } from "../fix/confirm-modal";
import type { LargeReportExportDecision } from "./report-export";
import { formatSize } from "../utils/format";

export type LargeReportWarningDetails = {
	reportBytes: number;
	thresholdBytes: number;
	findingCount: number;
};

export function showLargeReportWarningModal(
	app: App,
	details: LargeReportWarningDetails,
): Promise<LargeReportExportDecision> {
	return new Promise((resolve) => {
		new LargeReportWarningModal(app, details, resolve).open();
	});
}

class LargeReportWarningModal extends Modal {
	private readonly settle: (decision: LargeReportExportDecision) => boolean;

	constructor(
		app: App,
		private readonly details: LargeReportWarningDetails,
		resolve: (decision: LargeReportExportDecision) => void,
	) {
		super(app);
		this.settle = createSingleUseResolver(resolve);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");
		contentEl.createEl("h3", { text: "Large report warning" });
		contentEl.createEl("p", {
			text: "The full report may make Obsidian unresponsive while indexing it.",
		});

		this.renderDetail("Full report size", formatSize(this.details.reportBytes));
		this.renderDetail("Warning threshold", formatSize(this.details.thresholdBytes));
		this.renderDetail("Active findings", String(this.details.findingCount));

		contentEl.createEl("p", {
			text: "A summary keeps scan totals while omitting per-finding details.",
		});

		const buttons = contentEl.createDiv({
			cls: "vi-confirm-buttons vi-large-report-buttons",
		});
		buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish(null));
		buttons.createEl("button", {
			text: "Export full report anyway",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish("full"));
		buttons.createEl("button", {
			cls: "mod-cta",
			text: "Export summary only",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish("summary"));
	}

	onClose() {
		this.contentEl.empty();
		this.settle(null);
	}

	private renderDetail(label: string, value: string) {
		const row = this.contentEl.createDiv({ cls: "vi-issue-target" });
		row.createSpan({ cls: "vi-issue-target-label", text: label });
		row.createSpan({ cls: "vi-issue-target-value", text: value });
	}

	private finish(decision: LargeReportExportDecision) {
		if (this.settle(decision)) this.close();
	}
}
