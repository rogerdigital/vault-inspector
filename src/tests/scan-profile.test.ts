import { describe, expect, it } from "vitest";
import { SCANNER_IDS } from "../scanner/Issue";
import { createScanProfile } from "../scanner/scan-profile";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../settings/settings";

function makeSettings(): InspectorSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

async function expectProfileToChange(
	mutate: (settings: InspectorSettings) => void,
): Promise<void> {
	const baseline = await createScanProfile(makeSettings());
	const changed = makeSettings();
	mutate(changed);
	expect(await createScanProfile(changed)).not.toBe(baseline);
}

describe("createScanProfile", () => {
	it("normalizes set-like detection settings regardless of duplicates or order", async () => {
		const first = makeSettings();
		first.ignoredFolders = ["templates", "archive", "templates"];
		first.watchedTags = ["status", "important", "status"];
		first.ignoredFoldersByScanner["broken-links"] = ["trash", "cache", "trash"];
		first.ignoredFoldersByScanner["tag-usage"] = ["journal", "archive"];

		const second = makeSettings();
		second.ignoredFolders = ["archive", "templates"];
		second.watchedTags = ["important", "status"];
		second.ignoredFoldersByScanner = Object.fromEntries(
			[...SCANNER_IDS].reverse().map((scannerId) => [
				scannerId,
				scannerId === "broken-links"
					? ["cache", "trash"]
					: scannerId === "tag-usage"
						? ["archive", "journal"]
						: [],
			]),
		) as InspectorSettings["ignoredFoldersByScanner"];

		expect(await createScanProfile(first)).toBe(await createScanProfile(second));
	});

	it("normalizes ignored folders as paths and ignores empty entries", async () => {
		const first = makeSettings();
		first.ignoredFolders = ["archive/", "archive\\", "", "/"];
		first.ignoredFoldersByScanner["broken-links"] = ["trash/", "trash\\", ""];

		const second = makeSettings();
		second.ignoredFolders = ["archive"];
		second.ignoredFoldersByScanner["broken-links"] = ["trash"];

		expect(await createScanProfile(first)).toBe(await createScanProfile(second));
	});

	it("keeps ignored large Markdown path patterns distinct", async () => {
		const first = makeSettings();
		first.ignoredLargeMarkdownPathPatterns = ["drawings\\**"];

		const second = makeSettings();
		second.ignoredLargeMarkdownPathPatterns = ["drawings/**"];

		expect(await createScanProfile(first)).not.toBe(await createScanProfile(second));
	});

	it("uses the tag scanner's canonical watched-tag representation", async () => {
		const first = makeSettings();
		first.watchedTags = ["important", "#status"];

		const second = makeSettings();
		second.watchedTags = [" #important ", "status", "important", "", "   ", "#"];

		expect(await createScanProfile(first)).toBe(await createScanProfile(second));
	});

	it("distinguishes settings that collided under the previous hash", async () => {
		const first = makeSettings();
		first.ignoredFolders = ["Aa"];
		const second = makeSettings();
		second.ignoredFolders = ["BB"];

		expect(await createScanProfile(first)).not.toBe(await createScanProfile(second));
	});

	it("changes when the large Markdown threshold changes", async () => {
		await expectProfileToChange((settings) => {
			settings.largeMarkdownBytes += 1;
		});
	});

	it("ignores presentation-only settings", async () => {
		const baseline = await createScanProfile(makeSettings());
		const changed = makeSettings();
		changed.enableFixActions = !changed.enableFixActions;
		changed.duplicateKeepMode = "automatic";
		changed.reportFolderPath = "Reports";
		changed.ignoredIssueFingerprints = ["existing-issue"];

		expect(await createScanProfile(changed)).toBe(baseline);
	});

	it.each([
		["enabled scanners", (settings: InspectorSettings) => {
			settings.enabledScanners["broken-links"] = !settings.enabledScanners["broken-links"];
		}],
		["ignored folders", (settings: InspectorSettings) => {
			settings.ignoredFolders = ["archive"];
		}],
		["per-scanner ignored folders", (settings: InspectorSettings) => {
			settings.ignoredFoldersByScanner["broken-links"] = ["archive"];
		}],
		["large attachment threshold", (settings: InspectorSettings) => {
			settings.largeAttachmentBytes += 1;
		}],
		["ignored large Markdown frontmatter keys", (settings: InspectorSettings) => {
			settings.ignoredLargeMarkdownFrontmatterKeys = ["canvas"];
		}],
		["ignored large Markdown path patterns", (settings: InspectorSettings) => {
			settings.ignoredLargeMarkdownPathPatterns = ["drawings/**"];
		}],
		["duplicate hash cap", (settings: InspectorSettings) => {
			settings.duplicateHashMaxBytes += 1;
		}],
		["low-usage tag threshold", (settings: InspectorSettings) => {
			settings.lowUsageTagThreshold += 1;
		}],
		["empty-note word threshold", (settings: InspectorSettings) => {
			settings.emptyNoteWordThreshold += 1;
		}],
		["watched tags", (settings: InspectorSettings) => {
			settings.watchedTags = ["important"];
		}],
		["ignored properties", (settings: InspectorSettings) => {
			settings.ignoredProperties = ["private"];
		}],
		["unresolved note link policy", (settings: InspectorSettings) => {
			settings.ignoreUnresolvedNoteLinks = true;
		}],
	])("changes when %s changes", async (_name, mutate) => {
		await expectProfileToChange(mutate);
	});
});
