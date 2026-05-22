import { readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

manifest.version = packageJson.version;
versions[packageJson.version] = manifest.minAppVersion;

await writeFile("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);
await writeFile("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
await writeFile(
	"src/cli/version.ts",
	`export const TOOL_VERSION = "${packageJson.version}";\n`,
);
