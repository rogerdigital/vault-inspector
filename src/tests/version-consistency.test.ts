import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_VERSION } from "../../cli/version";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function readJson(path: string): Promise<Record<string, any>> {
	return JSON.parse(await readFile(path, "utf8"));
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) =>
			rm(path, { recursive: true, force: true }),
		),
	);
});

describe("version consistency", () => {
	it("keeps every published version source aligned", async () => {
		const packageJson = await readJson("package.json");
		const packageLock = await readJson("package-lock.json");
		const manifest = await readJson("manifest.json");
		const versions = await readJson("versions.json");

		expect(packageLock.version).toBe(packageJson.version);
		expect(packageLock.packages[""].version).toBe(packageJson.version);
		expect(manifest.version).toBe(packageJson.version);
		expect(TOOL_VERSION).toBe(packageJson.version);
		expect(versions[packageJson.version]).toBe(manifest.minAppVersion);
	});

	it("declares the Node runtime required by the CLI", async () => {
		const packageJson = await readJson("package.json");
		const packageLock = await readJson("package-lock.json");

		expect(packageJson.engines?.node).toBe(">=18");
		expect(packageLock.packages[""].engines?.node).toBe(packageJson.engines.node);
	});

	it("updates manifest, versions, and CLI version without editing npm metadata", async () => {
		const directory = await mkdtemp(join(tmpdir(), "vault-inspector-version-"));
		temporaryDirectories.push(directory);
		const packageJson = '{\n\t"version": "1.2.3"\n}\n';
		const packageLock = '{\n\t"version": "1.2.3"\n}\n';

		await writeFile(join(directory, "package.json"), packageJson);
		await writeFile(join(directory, "package-lock.json"), packageLock);
		await writeFile(
			join(directory, "manifest.json"),
			'{\n\t"version": "1.2.2",\n\t"minAppVersion": "1.7.2"\n}\n',
		);
		await writeFile(
			join(directory, "versions.json"),
			'{\n\t"1.2.2": "1.7.2"\n}\n',
		);
		await mkdir(join(directory, "cli"));
		await writeFile(
			join(directory, "cli/version.ts"),
			'export const TOOL_VERSION = "1.2.2";\n',
		);

		await execFileAsync(process.execPath, [join(process.cwd(), "version-bump.mjs")], {
			cwd: directory,
		});

		const manifest = await readJson(join(directory, "manifest.json"));
		const versions = await readJson(join(directory, "versions.json"));
		const cliVersion = await readFile(join(directory, "cli/version.ts"), "utf8");

		expect(manifest.version).toBe("1.2.3");
		expect(versions["1.2.3"]).toBe("1.7.2");
		expect(cliVersion).toBe('export const TOOL_VERSION = "1.2.3";\n');
		expect(await readFile(join(directory, "package.json"), "utf8")).toBe(
			packageJson,
		);
		expect(await readFile(join(directory, "package-lock.json"), "utf8")).toBe(
			packageLock,
		);
	});

	it("attests every release asset", async () => {
		const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
		const subjectPathBlock = releaseWorkflow.match(
			/subject-path:\s*\|\n((?:\s+\S+\n?)+)/,
		)?.[1];

		expect(subjectPathBlock).toContain("main.js");
		expect(subjectPathBlock).toContain("manifest.json");
		expect(subjectPathBlock).toContain("styles.css");
	});
});
