import { Plugin } from "obsidian";

export default class VaultInspectorPlugin extends Plugin {
	async onload() {
		console.log("Vault Inspector: loaded");
	}

	onunload() {
		console.log("Vault Inspector: unloaded");
	}
}
