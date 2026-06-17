import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["**/*.js", "**/*.mjs", "**/*.json", "src/tests/**", "vitest.config.ts"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},
	{
		files: ["src/cli/**/*.ts"],
		languageOptions: {
			globals: {
				AbortController: "readonly",
				Buffer: "readonly",
				console: "readonly",
				fetch: "readonly",
				process: "readonly",
				Response: "readonly",
				URL: "readonly",
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
			"no-restricted-globals": "off",
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
]);
