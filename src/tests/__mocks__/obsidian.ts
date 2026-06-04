import { vi } from "vitest";

export const requestUrl = vi.fn();

export class Plugin {
	app: unknown;

	loadData = vi.fn(async () => ({}));
	saveData = vi.fn(async () => {});
	registerView = vi.fn();
	addCommand = vi.fn();
	addSettingTab = vi.fn();
	addRibbonIcon = vi.fn();
}

export class ItemView {
	app: unknown;
	containerEl: { children: unknown[] };

	constructor(public leaf: { app?: unknown }) {
		this.app = leaf.app;
		this.containerEl = { children: [] };
	}
}

export class MarkdownView {}

export class Modal {
	contentEl = {
		empty: vi.fn(),
		createEl: vi.fn(() => ({ addEventListener: vi.fn() })),
	};

	constructor(public app: unknown) {}
	open = vi.fn();
	close = vi.fn();
	onOpen = vi.fn();
	onClose = vi.fn();
}

export class Notice {
	constructor(public message: string) {}
}

export class PluginSettingTab {
	constructor(public app: unknown, public plugin: unknown) {}
}

export class TFile {
	constructor(public path: string) {}
}

export class WorkspaceLeaf {
	constructor(public app?: unknown, public view?: unknown) {}
}

export const setIcon = vi.fn();
export const setTooltip = vi.fn();
