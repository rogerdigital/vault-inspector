import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");

describe("CLI package contract", () => {
	it("exposes the terminal commands through npm bin metadata", () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(root, "package.json"), "utf8"),
		);

		expect(pkg.bin).toEqual({
			"vault-inspector": "cli.js",
			"vinspect": "cli.js",
		});
		expect(pkg.files).toContain("cli.js");
	});

	it("keeps the CLI entrypoint source in cli/", () => {
		expect(fs.existsSync(path.join(root, "cli/bin.ts"))).toBe(true);
	});

	it("builds a separate CLI bundle in production builds", () => {
		const buildConfig = fs.readFileSync(
			path.join(root, "esbuild.config.mjs"),
			"utf8",
		);

		expect(buildConfig).toContain('entryPoints: ["cli/bin.ts"]');
		expect(buildConfig).toContain('outfile: "cli.js"');
	});
});
