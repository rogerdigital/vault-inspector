import { PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
import type VaultInspectorPlugin from "../main";
import { SCANNER_IDS, SCANNER_LABELS } from "../scanner/Issue";

export function parseFolderList(value: string): string[] {
	return [...new Set(
		value
			.split(",")
			.map((folder) => folder.trim())
			.filter(Boolean),
	)];
}

interface SettingItemSpec {
	name: string;
	desc?: string;
	render: (setting: Setting) => void;
}

interface SettingSectionSpec {
	heading: string;
	items: SettingItemSpec[];
}

export class InspectorSettingTab extends PluginSettingTab {
	plugin: VaultInspectorPlugin;

	constructor(app: App, plugin: VaultInspectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.getSections().map(({ heading, items }) => ({
			type: "group",
			heading,
			items: items.map(({ name, desc, render }) => ({
				name,
				...(desc === undefined ? {} : { desc }),
				render,
			})),
		}));
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("Scanning").setHeading();

		for (const section of this.getSections()) {
			new Setting(containerEl).setName(section.heading).setHeading();
			for (const item of section.items) {
				const setting = new Setting(containerEl).setName(item.name);
				if (item.desc !== undefined) {
					setting.setDesc(item.desc);
				}
				item.render(setting);
			}
		}
	}

	private getSections(): SettingSectionSpec[] {
		return [
			{
				heading: "Enabled scanners",
				items: SCANNER_IDS.map((id) => ({
					name: SCANNER_LABELS[id],
					...(id === "external-links"
						? {
							desc: "Opt-in network check for HTTP/HTTPS urls. Can be slower and depends on external sites.",
						}
						: {}),
					render: (setting) => {
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.enabledScanners[id])
								.onChange(async (value) => {
									this.plugin.settings.enabledScanners[id] = value;
									await this.plugin.saveSettings();
								}),
						);
					},
					})),
				},
				{
					heading: "Automatic scanning",
					items: [
						{
							name: "Automatic scan interval (hours)",
							desc: "Run one read-only scan after startup when the last successful scan is older than this many hours. 0 disables automatic scans.",
							render: (setting) => {
								setting.addSlider((slider) =>
									slider.setLimits(0, 168, 1)
										.setValue(this.plugin.settings.automaticScanIntervalHours)
										.onChange(async (value) => {
											this.plugin.settings.automaticScanIntervalHours = value;
											await this.plugin.saveSettings();
										}),
								);
							},
						},
						{
							name: "Automatic scan network checks",
							desc: "Allow automatic scans to include the external link scanner. Off by default, so automatic scans never touch the network without a separate opt-in.",
							render: (setting) => {
								setting.addToggle((toggle) =>
									toggle.setValue(this.plugin.settings.automaticScanNetworkChecks)
										.onChange(async (value) => {
											this.plugin.settings.automaticScanNetworkChecks = value;
											await this.plugin.saveSettings();
										}),
								);
							},
						},
					],
				},
				{
					heading: "Fix actions",
				items: [
					{
						name: "Enable fix actions",
						desc: "Show fix buttons for safe automatic actions, including editing notes and moving files to trash.",
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(this.plugin.settings.enableFixActions)
									.onChange(async (value) => {
										this.plugin.settings.enableFixActions = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Duplicate file keep mode",
						desc: "Always ask which hash-identical file to keep, or automatically keep the first vault-relative path in alphabetical order.",
						render: (setting) => {
							setting.addDropdown((dropdown) =>
								dropdown
									.addOption("always-ask", "Always ask")
									.addOption("automatic", "Automatically choose")
									.setValue(this.plugin.settings.duplicateKeepMode)
									.onChange(async (value) => {
										this.plugin.settings.duplicateKeepMode =
											value === "automatic" ? "automatic" : "always-ask";
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				heading: "Thresholds",
				items: [
					{
						name: "Large Markdown threshold (kb)",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(50, 1000, 50)
									.setValue(this.plugin.settings.largeMarkdownBytes / 1024)
									.onChange(async (value) => {
										this.plugin.settings.largeMarkdownBytes = value * 1024;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Large attachment threshold (mb)",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(1, 50, 1)
									.setValue(this.plugin.settings.largeAttachmentBytes / (1024 * 1024))
									.onChange(async (value) => {
										this.plugin.settings.largeAttachmentBytes = value * 1024 * 1024;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Ignored large Markdown frontmatter keys",
						desc: "Markdown files with any of these frontmatter keys are excluded from large file checks.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.ignoredLargeMarkdownFrontmatterKeys.join(", "))
									.setPlaceholder("Frontmatter keys to ignore")
									.onChange(async (value) => {
										this.plugin.settings.ignoredLargeMarkdownFrontmatterKeys =
											value.split(",").map((key) => key.trim()).filter(Boolean);
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Ignored large Markdown path patterns",
						desc: "Vault-relative glob patterns excluded from large Markdown checks.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.ignoredLargeMarkdownPathPatterns.join(", "))
									.setPlaceholder("E.g. index/**/*.md, **/*.canvas.md")
									.onChange(async (value) => {
										this.plugin.settings.ignoredLargeMarkdownPathPatterns =
											value.split(",").map((pattern) => pattern.trim()).filter(Boolean);
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Duplicate hash cap (mb)",
						desc: "Files above this size are reported as candidates without content hashing.",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(1, 10, 1)
									.setValue(this.plugin.settings.duplicateHashMaxBytes / (1024 * 1024))
									.onChange(async (value) => {
										this.plugin.settings.duplicateHashMaxBytes = value * 1024 * 1024;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Empty note word threshold",
						desc: "Notes with this many words or fewer are flagged as empty/stub.",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(0, 20, 1)
									.setValue(this.plugin.settings.emptyNoteWordThreshold)
									.onChange(async (value) => {
										this.plugin.settings.emptyNoteWordThreshold = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				heading: "Tags",
				items: [
					{
						name: "Watched tags (comma-separated)",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.watchedTags.join(", "))
									.setPlaceholder("E.g. Todo, review, project")
									.onChange(async (value) => {
										this.plugin.settings.watchedTags =
											value.split(",").map((tag) => tag.trim()).filter(Boolean);
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Low usage tag threshold",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(1, 10, 1)
									.setValue(this.plugin.settings.lowUsageTagThreshold)
									.onChange(async (value) => {
										this.plugin.settings.lowUsageTagThreshold = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				heading: "Ignored items",
				items: [
					{
						name: "Ignored folders (comma-separated)",
						desc: "Files in these folders are excluded from every scanner.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.ignoredFolders.join(", "))
									.setPlaceholder("E.g. Templates, archive")
									.onChange(async (value) => {
										this.plugin.settings.ignoredFolders = parseFolderList(value);
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Ignore unresolved note links",
						desc: "Unresolved plain wikilinks such as [[Future Note]] are treated as intentional. Embeds, missing attachments, Markdown links, and missing headings are still reported. Path-like wikilinks are also ignored, so leave this off when typos must fail the scan.",
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(this.plugin.settings.ignoreUnresolvedNoteLinks)
									.onChange(async (value) => {
										this.plugin.settings.ignoreUnresolvedNoteLinks = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Ignored frontmatter properties (comma-separated)",
						desc: "These properties are excluded from type consistency checks.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.ignoredProperties.join(", "))
									.setPlaceholder("E.g. Cssclasses, aliases")
									.onChange(async (value) => {
										this.plugin.settings.ignoredProperties =
											value.split(",").map((property) => property.trim()).filter(Boolean);
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				heading: "Scanner-specific ignored folders",
				items: SCANNER_IDS.map((id) => ({
					name: SCANNER_LABELS[id],
					desc: `Additional folders excluded only from ${SCANNER_LABELS[id]}.`,
					render: (setting) => {
						setting.addText((text) =>
							text
								.setValue(
									this.plugin.settings.ignoredFoldersByScanner[id].join(", "),
								)
								.setPlaceholder("E.g. Templates, archive")
								.onChange(async (value) => {
									this.plugin.settings.ignoredFoldersByScanner[id] =
										parseFolderList(value);
									await this.plugin.saveSettings();
								}),
						);
					},
				})),
			},
			{
				heading: "Export",
				items: [
					{
						name: "Report folder",
						desc: "Folder for exported Markdown reports.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(this.plugin.settings.reportFolderPath)
									.setPlaceholder("Inspector reports")
									.onChange(async (value) => {
										this.plugin.settings.reportFolderPath =
											value.trim() || "Inspector reports";
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
		];
	}
}
