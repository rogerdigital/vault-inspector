import { PluginSettingTab, App, Setting } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";
import type { ScannerId } from "../scanner/Issue";

export class InspectorSettingTab extends PluginSettingTab {
	plugin: VaultInspectorPlugin;

	constructor(app: App, plugin: VaultInspectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Vault Inspector Settings" });
		this.addScannersSection();
		this.addThresholdsSection();
		this.addTagsSection();
		this.addIgnoredSection();
		this.addExportSection();
	}

	private addScannersSection() {
		const { containerEl } = this;
		containerEl.createEl("h3", { text: "Enabled Scanners" });
		for (const id of SCANNER_IDS) {
			new Setting(containerEl)
				.setName(SCANNER_LABELS[id])
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.enabledScanners[id])
						.onChange(async (value) => {
							this.plugin.settings.enabledScanners[id] = value;
							await this.plugin.saveSettings();
						}),
				);
		}
	}

	private addThresholdsSection() {
		const { containerEl } = this;
		containerEl.createEl("h3", { text: "Thresholds" });
		new Setting(containerEl)
			.setName("Large Markdown threshold (KB)")
			.addSlider((slider) =>
				slider.setLimits(50, 1000, 50)
					.setValue(this.plugin.settings.largeMarkdownBytes / 1024)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.largeMarkdownBytes = value * 1024;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Large attachment threshold (MB)")
			.addSlider((slider) =>
				slider.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.largeAttachmentBytes / (1024 * 1024))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.largeAttachmentBytes = value * 1024 * 1024;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Duplicate hash cap (MB)")
			.setDesc("Files above this size are reported as candidates without content hashing.")
			.addSlider((slider) =>
				slider.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.duplicateHashMaxBytes / (1024 * 1024))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.duplicateHashMaxBytes = value * 1024 * 1024;
						await this.plugin.saveSettings();
					}),
			);
	}

	private addTagsSection() {
		const { containerEl } = this;
		containerEl.createEl("h3", { text: "Tags" });
		new Setting(containerEl)
			.setName("Watched tags (comma-separated)")
			.addText((text) =>
				text.setValue(this.plugin.settings.watchedTags.join(", "))
					.setPlaceholder("e.g. todo, review, project")
					.onChange(async (value) => {
						this.plugin.settings.watchedTags = value.split(",").map((t) => t.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Low usage tag threshold")
			.addSlider((slider) =>
				slider.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.lowUsageTagThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.lowUsageTagThreshold = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private addIgnoredSection() {
		const { containerEl } = this;
		containerEl.createEl("h3", { text: "Ignored Items" });
		new Setting(containerEl)
			.setName("Ignored folders (comma-separated)")
			.setDesc("Files in these folders are excluded from scans.")
			.addText((text) =>
				text.setValue(this.plugin.settings.ignoredFolders.join(", "))
					.setPlaceholder("e.g. templates, archive")
					.onChange(async (value) => {
						this.plugin.settings.ignoredFolders = value.split(",").map((f) => f.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Ignored frontmatter properties (comma-separated)")
			.setDesc("These properties are excluded from type consistency checks.")
			.addText((text) =>
				text.setValue(this.plugin.settings.ignoredProperties.join(", "))
					.setPlaceholder("e.g. cssclasses, aliases")
					.onChange(async (value) => {
						this.plugin.settings.ignoredProperties = value.split(",").map((p) => p.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);
	}

	private addExportSection() {
		const { containerEl } = this;
		containerEl.createEl("h3", { text: "Export" });
		new Setting(containerEl)
			.setName("Report folder")
			.setDesc("Folder for exported Markdown reports.")
			.addText((text) =>
				text.setValue(this.plugin.settings.reportFolderPath)
					.setPlaceholder("Vault Inspector Reports")
					.onChange(async (value) => {
						this.plugin.settings.reportFolderPath = value.trim() || "Vault Inspector Reports";
						await this.plugin.saveSettings();
					}),
			);
	}
}
