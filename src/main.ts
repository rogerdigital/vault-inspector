import { Plugin, Notice } from "obsidian";
import { InspectorView, VIEW_TYPE_INSPECTOR } from "./report/InspectorView";
import { ScanRunner } from "./scanner/ScanRunner";
import { brokenLinksScanner } from "./scanner/scanners/broken-links";
import { largeFilesScanner } from "./scanner/scanners/large-files";
import { orphanAttachmentsScanner } from "./scanner/scanners/orphan-attachments";
import { duplicateFilesScanner } from "./scanner/scanners/duplicate-files";
import { frontmatterTypesScanner } from "./scanner/scanners/frontmatter-types";
import { tagUsageScanner } from "./scanner/scanners/tag-usage";
import { DEFAULT_SETTINGS, type InspectorSettings } from "./settings/settings";
import { InspectorSettingTab } from "./settings/settings-tab";
import { generateMarkdownReport } from "./report/markdown-export";

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
		this.addCommand({
			id: "export-report",
			name: "Export report",
			callback: () => this.exportReport(),
		});
		this.scanRunner.register(brokenLinksScanner);
		this.scanRunner.register(largeFilesScanner);
		this.scanRunner.register(orphanAttachmentsScanner);
		this.scanRunner.register(duplicateFilesScanner);
		this.scanRunner.register(frontmatterTypesScanner);
		this.scanRunner.register(tagUsageScanner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));

		this.addRibbonIcon("search", "Vault Inspector: Run scan", () => this.runScan());
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
		view.setCallbacks({
			onIgnoreIssue: async (issue) => {
				this.settings.ignoredIssueFingerprints.push(issue.fingerprint);
				await this.saveSettings();
				new Notice(`Ignored: ${issue.title}`);
				view.setScanning(true);
				const result = await this.scanRunner.run(this.app, this.settings);
				view.setResult(result);
			},
			onRevealFile: async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file) {
					await this.app.workspace.getLeaf(false).openFile(file as any);
				} else {
					new Notice(`File not found: ${path}`);
				}
			},
		});
		view.setScanning(true);
		const result = await this.scanRunner.run(this.app, this.settings);
		view.setResult(result);
	}

	private async exportReport() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR);
		const view = leaves[0]?.view as InspectorView | undefined;
		if (!view || !view.hasResult()) {
			new Notice("Run a scan first before exporting.");
			return;
		}

		const result = view.getResult()!;
		const report = generateMarkdownReport(result);
		const folder = this.settings.reportFolderPath;
		const now = new Date();
		const filename = `Vault Inspector Report ${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`;
		const filepath = `${folder}/${filename}`;

		await this.app.vault.createFolder(folder).catch(() => {});
		await this.app.vault.create(filepath, report);
		new Notice(`Report exported to ${filepath}`);
	}
}
