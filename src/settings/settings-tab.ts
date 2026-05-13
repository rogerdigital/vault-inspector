import { PluginSettingTab, App, Setting } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";

export class InspectorSettingTab extends PluginSettingTab {
	plugin: VaultInspectorPlugin;

	constructor(app: App, plugin: VaultInspectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("Scanning").setHeading();
		this.addScannersSection();
		this.addThresholdsSection();
		this.addTagsSection();
		this.addIgnoredSection();
		this.addExportSection();
	}

	private addScannersSection() {
		const { containerEl } = this;
		new Setting(containerEl).setName("Enabled scanners").setHeading();
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
		new Setting(containerEl).setName("Thresholds").setHeading();
		new Setting(containerEl)
			.setName("Large Markdown threshold (kb)")
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
			.setName("Large attachment threshold (mb)")
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
			.setName("Duplicate hash cap (mb)")
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
		new Setting(containerEl).setName("Tags").setHeading();
		new Setting(containerEl)
			.setName("Watched tags (comma-separated)")
			.addText((text) =>
				text.setValue(this.plugin.settings.watchedTags.join(", "))
					.setPlaceholder("E.g. Todo, review, project")
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
		new Setting(containerEl).setName("Ignored items").setHeading();
		new Setting(containerEl)
			.setName("Ignored folders (comma-separated)")
			.setDesc("Files in these folders are excluded from scans.")
			.addText((text) =>
				text.setValue(this.plugin.settings.ignoredFolders.join(", "))
					.setPlaceholder("E.g. Templates, archive")
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
					.setPlaceholder("E.g. Cssclasses, aliases")
					.onChange(async (value) => {
						this.plugin.settings.ignoredProperties = value.split(",").map((p) => p.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);
	}

	private addExportSection() {
		const { containerEl } = this;
		new Setting(containerEl).setName("Export").setHeading();
		new Setting(containerEl)
			.setName("Report folder")
			.setDesc("Folder for exported Markdown reports.")
			.addText((text) =>
				text.setValue(this.plugin.settings.reportFolderPath)
					.setPlaceholder("Inspector reports")
					.onChange(async (value) => {
						this.plugin.settings.reportFolderPath = value.trim() || "Inspector reports";
						await this.plugin.saveSettings();
					}),
			);
	}
}
