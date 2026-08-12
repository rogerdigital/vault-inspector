import type { App } from "obsidian";

type SettingsApi = {
	open?: unknown;
	openTabById?: unknown;
};

export function openPluginSettings(app: App, pluginId: string): boolean {
	const setting = (app as App & { setting?: SettingsApi }).setting;
	if (
		!setting
		|| typeof setting.open !== "function"
		|| typeof setting.openTabById !== "function"
	) {
		return false;
	}
	const availableSetting = setting as {
		open: () => void;
		openTabById: (id: string) => void;
	};

	try {
		availableSetting.open();
		availableSetting.openTabById(pluginId);
		return true;
	} catch {
		return false;
	}
}
