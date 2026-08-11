import { App, Modal } from "obsidian";
import { createSingleUseResolver } from "../fix/confirm-modal";
import type { Issue, ScannerId } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import { getParentFolder, isInFolder } from "../utils/paths";

export type FolderExclusionRequest = {
	scannerId: ScannerId;
	folder: string;
	affectedCount: number;
};

export function buildFolderExclusionRequest(
	issue: Issue,
	visibleIssues: Issue[],
): FolderExclusionRequest | null {
	const path = issue.primaryPath ?? issue.relatedPaths[0];
	if (!path) return null;
	const folder = getParentFolder(path);
	if (!folder) return null;

	const affectedCount = visibleIssues.filter((candidate) => {
		if (candidate.scannerId !== issue.scannerId) return false;
		const candidatePath = candidate.primaryPath ?? candidate.relatedPaths[0];
		return candidatePath ? isInFolder(candidatePath, folder) : false;
	}).length;

	return { scannerId: issue.scannerId, folder, affectedCount };
}

export function showFolderExclusionModal(
	app: App,
	request: FolderExclusionRequest,
): Promise<boolean> {
	return new Promise((resolve) => {
		new FolderExclusionModal(app, request, resolve).open();
	});
}

class FolderExclusionModal extends Modal {
	private readonly settle: (result: boolean) => boolean;

	constructor(
		app: App,
		private readonly request: FolderExclusionRequest,
		resolve: (result: boolean) => void,
	) {
		super(app);
		this.settle = createSingleUseResolver(resolve);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");
		contentEl.createEl("h3", { text: "Exclude parent folder" });
		contentEl.createEl("p", {
			text: "Future scans will skip this folder for the selected scanner.",
		});

		this.renderDetail("Scanner", SCANNER_LABELS[this.request.scannerId]);
		this.renderDetail("Folder", this.request.folder);
		this.renderDetail("Affected findings", String(this.request.affectedCount));

		const buttons = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish(false));
		buttons.createEl("button", {
			text: "Exclude folder",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish(true));
	}

	onClose() {
		this.contentEl.empty();
		this.settle(false);
	}

	private renderDetail(label: string, value: string) {
		const row = this.contentEl.createDiv({ cls: "vi-issue-target" });
		row.createSpan({ cls: "vi-issue-target-label", text: label });
		row.createSpan({ cls: "vi-issue-target-value", text: value });
	}

	private finish(result: boolean) {
		if (this.settle(result)) this.close();
	}
}
