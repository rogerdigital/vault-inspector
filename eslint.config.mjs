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
		files: ["cli/**/*.ts"],
		linterOptions: {
			reportUnusedDisableDirectives: "off",
		},
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
			"no-restricted-globals": "off",
			"obsidianmd/no-global-this": "off",
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
]);
