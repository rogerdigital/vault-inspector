import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	resolve: {
		alias: {
			"obsidian": path.resolve(__dirname, "src/tests/__mocks__/obsidian.ts"),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/tests/**"],
			thresholds: {
				lines: 40,
				functions: 40,
				branches: 50,
			},
		},
	},
});
