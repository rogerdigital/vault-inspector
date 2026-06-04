import { Plugin, Notice, TFile, requestUrl } from "obsidian";
import { InspectorView, VIEW_TYPE_INSPECTOR } from "./report/InspectorView";
import { ScanRunner } from "./scanner/ScanRunner";
import { registerDefaultScanners } from "./scanner/register-scanners";
import { DEFAULT_SETTINGS, type InspectorSettings } from "./settings/settings";
import { InspectorSettingTab } from "./settings/settings-tab";
import { generateMarkdownReport } from "./report/markdown-export";
import { executeFixAction } from "./fix/fix-executor";
import { showConfirmModal } from "./fix/confirm-modal";

export default class VaultInspectorPlugin extends Plugin {
	settings: InspectorSettings = DEFAULT_SETTINGS;
	scanRunner = new ScanRunner(async (url) => {
		const response = await requestUrl({ url, method: "HEAD" });
		return response.status;
	});

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
		registerDefaultScanners(this.scanRunner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));

		this.addRibbonIcon("shield-check", "Run scan", () => this.runScan());
	}

	onunload() {}

	async loadSettings() {
		this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() } as InspectorSettings;
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

		const view = leaf.view as unknown as InspectorView;
		view.setCallbacks({
			onIgnoreAllIssues: async (issues) => {
				for (const issue of issues) {
					this.settings.ignoredIssueFingerprints.push(issue.fingerprint);
				}
				await this.saveSettings();
				new Notice(`Ignored ${issues.length} issue(s)`);
				await this.scanAndRender(view);
			},
			onRestoreIssues: async (issues) => {
				const toRestore = new Set(issues.map((i) => i.fingerprint));
				this.settings.ignoredIssueFingerprints = this.settings.ignoredIssueFingerprints.filter(
					(fp) => !toRestore.has(fp),
				);
				await this.saveSettings();
				new Notice(`Restored ${issues.length} issue(s)`);
				await this.scanAndRender(view);
			},
			onFixAllIssues: async (issues) => {
				const actions = issues.map((i) => i.fixAction!).filter(Boolean);
				if (actions.length === 0) return;
				const confirmed = await showConfirmModal(this.app, actions);
				if (!confirmed) return;
				let fixed = 0;
				for (const action of actions) {
					try {
						await executeFixAction(this.app, action);
						fixed++;
					} catch {
						// continue on individual failures
					}
				}
				new Notice(`Fixed ${fixed} issue(s)`);
				await this.scanAndRender(view);
			},
			onRevealFile: async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file) {
					if (file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(file);
					}
				} else {
					new Notice(`File not found: ${path}`);
				}
			},
			onRunScan: () => { void this.runScan(); },
		});
		view.setEnableFixActions(this.settings.enableFixActions);
		await this.scanAndRender(view);
	}

	private async scanAndRender(view: InspectorView) {
		view.setScanning(true);
		try {
			const result = await this.scanRunner.run(this.app, this.settings);
			view.setResult(result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Vault Inspector scan failed: ${message}`);
			view.setScanning(false);
		}
	}

	private async exportReport() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR);
		const view = leaves[0]?.view as unknown as InspectorView | undefined;
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
