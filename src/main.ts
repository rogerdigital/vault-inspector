import { Plugin } from "obsidian";
import { InspectorView, VIEW_TYPE_INSPECTOR } from "./report/InspectorView";
import { ScanRunner } from "./scanner/ScanRunner";
import { brokenLinksScanner } from "./scanner/scanners/broken-links";
import { largeFilesScanner } from "./scanner/scanners/large-files";
import { orphanAttachmentsScanner } from "./scanner/scanners/orphan-attachments";
import { duplicateFilesScanner } from "./scanner/scanners/duplicate-files";
import { DEFAULT_SETTINGS, type InspectorSettings } from "./settings/settings";
import { InspectorSettingTab } from "./settings/settings-tab";

export default class VaultInspectorPlugin extends Plugin {
	settings: InspectorSettings = DEFAULT_SETTINGS;
	scanRunner = new ScanRunner();

	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_INSPECTOR, (leaf) => new InspectorView(leaf));
		this.addCommand({
			id: "run-scan",
			name: "Run scan",
			callback: () => this.runScan(),
		});
		this.scanRunner.register(brokenLinksScanner);
		this.scanRunner.register(largeFilesScanner);
		this.scanRunner.register(orphanAttachmentsScanner);
		this.scanRunner.register(duplicateFilesScanner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async runScan() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR)[0];
		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_INSPECTOR, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as InspectorView;
		view.setScanning(true);
		const result = await this.scanRunner.run(this.app, this.settings);
		view.setResult(result);
	}
}
