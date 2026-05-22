import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	banner: {
		js: "/* eslint-disable */",
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	await esbuild.build({
		banner: {
			js: "#!/usr/bin/env node\n/* eslint-disable */",
		},
		entryPoints: ["src/cli/bin.ts"],
		bundle: true,
		external: ["obsidian", ...builtinModules],
		format: "cjs",
		platform: "node",
		target: "node18",
		logLevel: "info",
		treeShaking: true,
		outfile: "cli.js",
	});
	process.exit(0);
} else {
	await context.watch();
}
