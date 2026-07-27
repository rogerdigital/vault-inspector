import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// `cli/**` is a standalone Node CLI (separately bundled to cli.js, never
	// shipped in main.js). The Obsidian review rules are designed for code that
	// runs inside Obsidian's Electron environment, so scanning CLI source with
	// them is a category error. Excluding it here mirrors how `src/tests/**`
	// is handled and keeps the community scorecard focused on plugin code.
	// CLI type safety is still enforced by `tsc -noEmit` in `npm run build`.
	{ ignores: ["**/*.js", "**/*.mjs", "**/*.json", "src/tests/**", "cli/**", "vitest.config.ts"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},
]);
