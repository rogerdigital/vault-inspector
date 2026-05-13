import { defineConfig } from "vitest/config";

export default defineConfig({
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
