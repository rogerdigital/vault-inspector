import { fileURLToPath } from "node:url";
import { createLocalApp } from "../../../cli/local-vault";
import { ScanRunner } from "../../scanner/ScanRunner";
import { registerDefaultScanners } from "../../scanner/register-scanners";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../../settings/settings";
import type { Issue, ScanResult } from "../../scanner/Issue";

/**
 * All fixture mtimes are pinned so time-dependent scanner behavior (the
 * 7-day orphan recency window) is deterministic in every test run.
 *
 * Assertions should locate findings by primaryPath/message, not array index —
 * scanner output order is not guaranteed across environments.
 */
export const FIXTURE_PAST_MTIME = Date.UTC(2020, 0, 1);

export type FixtureVaultOptions = {
	settings?: Partial<InspectorSettings>;
	mtimeOverrides?: Record<string, number>;
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
};

export type FixtureVaultScan = {
	root: string;
	settings: InspectorSettings;
	result: ScanResult;
	issues: Issue[];
};

export function fixtureVaultRoot(): string {
	return fileURLToPath(new URL("../fixtures/precision-vault", import.meta.url));
}

export async function scanFixtureVault(
	options: FixtureVaultOptions = {},
): Promise<FixtureVaultScan> {
	const app = await createLocalApp(fixtureVaultRoot());
	const mtimeOverrides = options.mtimeOverrides ?? {};
	const matched = new Set<string>();
	for (const file of app.vault.getFiles()) {
		const stat = file.stat as { ctime: number; mtime: number };
		stat.ctime = FIXTURE_PAST_MTIME;
		const override = mtimeOverrides[file.path];
		if (override !== undefined) matched.add(file.path);
		stat.mtime = override ?? FIXTURE_PAST_MTIME;
	}
	const unknown = Object.keys(mtimeOverrides).filter((key) => !matched.has(key));
	if (unknown.length > 0) {
		throw new Error(
			`mtimeOverrides reference unknown fixture paths: ${unknown.join(", ")}`,
		);
	}
	const settings: InspectorSettings = {
		...structuredClone(DEFAULT_SETTINGS),
		...options.settings,
	};
	const scanRunner = new ScanRunner(options.requestUrl, {
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) =>
			clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
	});
	registerDefaultScanners(scanRunner);
	const result = await scanRunner.run(app, settings);
	return { root: fixtureVaultRoot(), settings, result, issues: result.issues };
}
