# Safe Large Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Vault Inspector from writing a complete Markdown report larger than 1 MiB into an Obsidian vault unless the user explicitly accepts the indexing risk, while providing a compact summary export as the primary safe path.

**Architecture:** Keep UTF-8 measurement and the fixed threshold in a pure report-policy module, add an opt-in summary mode to the existing Markdown generator, and isolate the Obsidian choice UI in a dedicated modal. `VaultInspectorPlugin.exportReport` remains the orchestration boundary: it renders and measures before any vault mutation, then writes exactly the content selected by the user.

**Tech Stack:** TypeScript, Obsidian plugin API, Vitest, ESLint, esbuild.

---

## File map

- Create `src/report/report-export.ts`: fixed byte threshold, UTF-8 measurement, and the large-report decision type.
- Create `src/tests/report-export.test.ts`: pure UTF-8 and boundary tests.
- Modify `src/report/markdown-export.ts`: add default-full and explicit-summary rendering modes.
- Modify `src/tests/markdown-export.test.ts`: lock full compatibility and summary omissions/counts.
- Create `src/report/export-warning-modal.ts`: user choice UI for oversized reports.
- Create `src/tests/export-warning-modal.test.ts`: modal content and single-settlement behavior.
- Modify `src/main.ts`: enforce preflight before any vault mutation and surface export errors.
- Modify `src/tests/main.test.ts`: integration coverage for small, summary, full, cancel, ordering, and failure paths.
- Modify `README.md`: document the in-vault safety boundary and unchanged CLI behavior.

No settings, persisted-data schema, scanner, CLI, package manifest, version, or release workflow files change.

---

### Task 1: Add the pure large-report policy

**Files:**
- Create: `src/report/report-export.ts`
- Create: `src/tests/report-export.test.ts`

- [ ] **Step 1: Write the failing UTF-8 and threshold tests**

Create `src/tests/report-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	getUtf8ByteLength,
	MAX_SAFE_VAULT_REPORT_BYTES,
	requiresLargeReportConfirmation,
} from "../report/report-export";

describe("large report export policy", () => {
	it("measures UTF-8 bytes instead of JavaScript characters", () => {
		expect(getUtf8ByteLength("A")).toBe(1);
		expect(getUtf8ByteLength("中")).toBe(3);
		expect(getUtf8ByteLength("🙂")).toBe(4);
		expect(getUtf8ByteLength("A中🙂")).toBe(8);
	});

	it("allows exactly 1 MiB without confirmation", () => {
		const report = "a".repeat(MAX_SAFE_VAULT_REPORT_BYTES);

		expect(getUtf8ByteLength(report)).toBe(MAX_SAFE_VAULT_REPORT_BYTES);
		expect(requiresLargeReportConfirmation(report)).toBe(false);
	});

	it("requires confirmation above 1 MiB", () => {
		const report = "a".repeat(MAX_SAFE_VAULT_REPORT_BYTES + 1);

		expect(getUtf8ByteLength(report)).toBe(MAX_SAFE_VAULT_REPORT_BYTES + 1);
		expect(requiresLargeReportConfirmation(report)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/tests/report-export.test.ts
```

Expected: FAIL because `../report/report-export` does not exist.

- [ ] **Step 3: Implement the minimal policy module**

Create `src/report/report-export.ts`:

```ts
export const MAX_SAFE_VAULT_REPORT_BYTES = 1024 * 1024;

export type LargeReportExportDecision = "summary" | "full" | null;

export function getUtf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function requiresLargeReportConfirmation(report: string): boolean {
	return getUtf8ByteLength(report) > MAX_SAFE_VAULT_REPORT_BYTES;
}
```

- [ ] **Step 4: Run focused tests and build to verify GREEN**

Run:

```bash
npm test -- src/tests/report-export.test.ts
npm run build
git diff --check
```

Expected: 3 tests PASS; TypeScript/build and diff check exit 0.

- [ ] **Step 5: Commit the policy**

```bash
git add src/report/report-export.ts src/tests/report-export.test.ts
git commit -m "feat: define large report export policy"
```

---

### Task 2: Add compact Markdown summary generation

**Files:**
- Modify: `src/report/markdown-export.ts:5-72`
- Modify: `src/tests/markdown-export.test.ts:17-98`

- [ ] **Step 1: Add a failing summary-mode test**

Append this test inside the existing `describe("generateMarkdownReport", ...)` block in `src/tests/markdown-export.test.ts`:

```ts
	it("renders a compact summary without per-finding details", () => {
		const report = generateMarkdownReport(makeResult({
			scannersRun: ["broken-links", "empty-notes"],
			issues: [{
				scannerId: "broken-links",
				severity: "error",
				classification: "confirmed",
				explanation: {
					why: "The target does not exist.",
					caveat: "The source may be generated.",
					nextStep: "Create or correct the target.",
				},
				title: "SUMMARY-OMIT-TITLE",
				message: "SUMMARY-OMIT-MESSAGE",
				primaryPath: "SUMMARY-OMIT-PATH.md",
				relatedPaths: ["SUMMARY-OMIT-RELATED.md"],
				evidence: { target: "SUMMARY-OMIT-TARGET" },
				fingerprint: "summary-active",
			}],
		ignoredIssues: [{
				scannerId: "empty-notes",
				severity: "info",
				classification: "confirmed",
				explanation: {
					why: "Ignored fixture.",
					nextStep: "Keep ignored.",
				},
				title: "SUMMARY-OMIT-IGNORED",
				message: "Ignored fixture.",
				primaryPath: "ignored.md",
				relatedPaths: [],
				evidence: {},
				fingerprint: "summary-ignored",
			}],
		}), "summary");

		expect(report).toContain("# Vault Inspector Summary");
		expect(report).toContain("Finding details are omitted from this summary.");
		expect(report).toContain("| Total | 1 |");
		expect(report).toContain("| Errors | 1 |");
		expect(report).toContain("| Broken Links | 1 |");
		expect(report).toContain("| Empty Notes | 0 |");
		expect(report.indexOf("| Broken Links | 1 |"))
			.toBeLessThan(report.indexOf("| Empty Notes | 0 |"));
		expect(report).not.toMatch(/SUMMARY-OMIT/);
		expect(report).not.toContain("- **Classification:**");
		expect(report).not.toContain("- **Why:**");
		expect(report).not.toContain("- **Next step:**");
		expect(report).not.toMatch(/^## Resolved(?: items| findings)?/m);
	});
```

Keep the existing full-report test unchanged. It is the compatibility assertion for the default argument.

- [ ] **Step 2: Run the Markdown test and verify RED**

Run:

```bash
npm test -- src/tests/markdown-export.test.ts
```

Expected: FAIL because `generateMarkdownReport` does not accept summary mode and still renders the full report.

- [ ] **Step 3: Add the mode and early summary branch**

Replace the opening and common body of `generateMarkdownReport` through the `grouped` declaration with this code, then retain the existing full scanner/finding loop after the summary branch:

```ts
export type MarkdownReportMode = "full" | "summary";

export function generateMarkdownReport(
	result: ScanResult,
	mode: MarkdownReportMode = "full",
): string {
	const lines: string[] = [];
	const now = new Date();
	const isSummary = mode === "summary";

	lines.push(isSummary ? `# Vault Inspector Summary` : `# Vault Inspector Report`);
	lines.push(``);
	lines.push(`- **Date:** ${now.toLocaleString()}`);
	lines.push(`- **Files scanned:** ${result.filesScanned}`);
	lines.push(`- **Duration:** ${formatDuration(result.finishedAt - result.startedAt)}`);
	lines.push(`- **Scanners run:** ${result.scannersRun.length}`);
	lines.push(``);

	const errors = result.issues.filter((i) => i.severity === "error").length;
	const warnings = result.issues.filter((i) => i.severity === "warning").length;
	const infos = result.issues.filter((i) => i.severity === "info").length;

	lines.push(`## Summary`);
	lines.push(``);
	lines.push(`| Severity | Count |`);
	lines.push(`|---|---|`);
	lines.push(`| Total | ${result.issues.length} |`);
	lines.push(`| Errors | ${errors} |`);
	lines.push(`| Warnings | ${warnings} |`);
	lines.push(`| Info | ${infos} |`);
	lines.push(``);

	const grouped = groupByScanner(result.issues);

	if (isSummary) {
		lines.push(`Finding details are omitted from this summary.`);
		lines.push(``);
		lines.push(`## Findings by scanner`);
		lines.push(``);
		lines.push(`| Scanner | Count |`);
		lines.push(`|---|---|`);
		for (const scannerId of result.scannersRun) {
			lines.push(`| ${SCANNER_LABELS[scannerId]} | ${grouped[scannerId]?.length ?? 0} |`);
		}
		lines.push(``);
		return lines.join("\n");
	}
```

The full loop beginning with `for (const scannerId of result.scannersRun)` remains unchanged and follows this branch. This preserves the default full-report structure.

- [ ] **Step 4: Verify summary and CLI compatibility**

Run:

```bash
npm test -- src/tests/markdown-export.test.ts src/tests/cli.test.ts
npm run build
git diff --check
```

Expected: Markdown and CLI tests PASS. If the CLI loopback security case reports `listen EPERM 127.0.0.1`, rerun the same command in an environment allowed to bind loopback; do not change the test or production network policy.

- [ ] **Step 5: Commit summary generation**

```bash
git add src/report/markdown-export.ts src/tests/markdown-export.test.ts
git commit -m "feat: add compact markdown summaries"
```

---

### Task 3: Add the large-report warning modal

**Files:**
- Create: `src/report/export-warning-modal.ts`
- Create: `src/tests/export-warning-modal.test.ts`

- [ ] **Step 1: Create the failing modal tests**

Create `src/tests/export-warning-modal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;
type ElementOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
};

class FakeElement {
	children: FakeElement[] = [];
	cls = "";
	text: string | null = null;
	attr: Record<string, string> = {};
	private listeners = new Map<string, Listener>();

	constructor(readonly tag = "div", options: ElementOptions = {}) {
		this.cls = options.cls ?? "";
		this.text = options.text ?? null;
		this.attr = options.attr ?? {};
	}

	empty() { this.children = []; }
	addClass(cls: string) { this.cls = `${this.cls} ${cls}`.trim(); }
	createEl(tag: string, options: ElementOptions = {}) {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
	createDiv(options: ElementOptions = {}) { return this.createEl("div", options); }
	createSpan(options: ElementOptions = {}) { return this.createEl("span", options); }
	addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener); }
	click() { this.listeners.get("click")?.(); }
}

const { modalInstances } = vi.hoisted(() => ({
	modalInstances: [] as any[],
}));

vi.mock("obsidian", () => ({
	App: class {},
	Modal: class {
		contentEl = new FakeElement();
		constructor(public app: unknown) { modalInstances.push(this); }
		open() { this.onOpen(); }
		close() { this.onClose(); }
		onOpen() {}
		onClose() {}
	},
}));

import { showLargeReportWarningModal } from "../report/export-warning-modal";

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (element.text === text) return element;
	for (const child of element.children) {
		const result = findByText(child, text);
		if (result) return result;
	}
	return undefined;
}

function openWarning() {
	return showLargeReportWarningModal({} as any, {
		reportBytes: 3.2 * 1024 * 1024,
		thresholdBytes: 1024 * 1024,
		findingCount: 3881,
	});
}

describe("showLargeReportWarningModal", () => {
	beforeEach(() => { modalInstances.length = 0; });

	it("shows the indexing risk, sizes, and finding count", () => {
		void openWarning();
		const content = modalInstances[0].contentEl as FakeElement;

		expect(findByText(content, "Large report warning")).toBeDefined();
		expect(findByText(content,
			"The full report may make Obsidian unresponsive while indexing it.",
		)).toBeDefined();
		expect(findByText(content, "3.2 MB")).toBeDefined();
		expect(findByText(content, "1.0 MB")).toBeDefined();
		expect(findByText(content, "3881")).toBeDefined();
	});

	it.each([
		["Export summary only", "summary"],
		["Export full report anyway", "full"],
	] as const)("returns %s only once", async (label, expected) => {
		const result = openWarning();
		const modal = modalInstances[0];
		const button = findByText(modal.contentEl, label)!;

		expect(button.attr.type).toBe("button");
		button.click();
		button.click();
		modal.close();

		await expect(result).resolves.toBe(expected);
	});

	it("treats cancel and close as no decision", async () => {
		const cancelled = openWarning();
		findByText(modalInstances[0].contentEl, "Cancel")!.click();
		await expect(cancelled).resolves.toBeNull();

		const closed = openWarning();
		modalInstances[1].close();
		await expect(closed).resolves.toBeNull();
	});

	it("marks summary export as the primary action", () => {
		void openWarning();
		const button = findByText(
			modalInstances[0].contentEl,
			"Export summary only",
		)!;

		expect(button.cls).toContain("mod-cta");
	});
});
```

- [ ] **Step 2: Run the modal test and verify RED**

Run:

```bash
npm test -- src/tests/export-warning-modal.test.ts
```

Expected: FAIL because `../report/export-warning-modal` does not exist.

- [ ] **Step 3: Implement the warning modal**

Create `src/report/export-warning-modal.ts`:

```ts
import { App, Modal } from "obsidian";
import { createSingleUseResolver } from "../fix/confirm-modal";
import type { LargeReportExportDecision } from "./report-export";
import { formatSize } from "../utils/format";

export type LargeReportWarningDetails = {
	reportBytes: number;
	thresholdBytes: number;
	findingCount: number;
};

export function showLargeReportWarningModal(
	app: App,
	details: LargeReportWarningDetails,
): Promise<LargeReportExportDecision> {
	return new Promise((resolve) => {
		new LargeReportWarningModal(app, details, resolve).open();
	});
}

class LargeReportWarningModal extends Modal {
	private readonly settle: (result: LargeReportExportDecision) => boolean;

	constructor(
		app: App,
		private readonly details: LargeReportWarningDetails,
		resolve: (result: LargeReportExportDecision) => void,
	) {
		super(app);
		this.settle = createSingleUseResolver(resolve);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");
		contentEl.createEl("h3", { text: "Large report warning" });
		contentEl.createEl("p", {
			text: "The full report may make Obsidian unresponsive while indexing it.",
		});
		this.renderDetail("Full report size", formatSize(this.details.reportBytes));
		this.renderDetail("Warning threshold", formatSize(this.details.thresholdBytes));
		this.renderDetail("Active findings", String(this.details.findingCount));
		contentEl.createEl("p", {
			text: "A summary keeps scan totals while omitting per-finding details.",
		});

		const buttons = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		buttons.createEl("button", {
			text: "Cancel",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish(null));
		buttons.createEl("button", {
			text: "Export full report anyway",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish("full"));
		buttons.createEl("button", {
			cls: "mod-cta",
			text: "Export summary only",
			attr: { type: "button" },
		}).addEventListener("click", () => this.finish("summary"));
	}

	onClose() {
		this.contentEl.empty();
		this.settle(null);
	}

	private renderDetail(label: string, value: string) {
		const row = this.contentEl.createDiv({ cls: "vi-issue-target" });
		row.createSpan({ cls: "vi-issue-target-label", text: label });
		row.createSpan({ cls: "vi-issue-target-value", text: value });
	}

	private finish(result: LargeReportExportDecision) {
		if (this.settle(result)) this.close();
	}
}
```

- [ ] **Step 4: Verify the modal and existing modal pattern**

Run:

```bash
npm test -- src/tests/export-warning-modal.test.ts src/tests/exclude-folder-modal.test.ts src/tests/confirm-modal.test.ts
npm run lint:obsidian-warnings
npm run build
git diff --check
```

Expected: all focused modal tests PASS; warning lint, build, and diff check exit 0.

- [ ] **Step 5: Commit the modal**

```bash
git add src/report/export-warning-modal.ts src/tests/export-warning-modal.test.ts
git commit -m "feat: warn about large in-vault reports"
```

---

### Task 4: Enforce the decision before vault mutation

**Files:**
- Modify: `src/main.ts:1-25,399-417`
- Modify: `src/tests/main.test.ts:11-49,87-96,1431-1471`

- [ ] **Step 1: Mock the warning boundary in the plugin test**

Extend the hoisted mock state at the top of `src/tests/main.test.ts`:

```ts
const {
	createScanProfileMock,
	executeFixActionMock,
	noticeMessages,
	openPluginSettingsMock,
	showConfirmModalMock,
	showLargeReportWarningModalMock,
} = vi.hoisted(() => ({
	createScanProfileMock: vi.fn(),
	executeFixActionMock: vi.fn(),
	noticeMessages: [] as string[],
	openPluginSettingsMock: vi.fn(),
	showConfirmModalMock: vi.fn(),
	showLargeReportWarningModalMock: vi.fn(),
}));
```

Add this module mock after the existing confirmation-modal mock:

```ts
vi.mock("../report/export-warning-modal", () => ({
	showLargeReportWarningModal: showLargeReportWarningModalMock,
}));
```

Reset it in `beforeEach`:

```ts
		showLargeReportWarningModalMock.mockReset();
```

Import the threshold beside the existing imports:

```ts
import { MAX_SAFE_VAULT_REPORT_BYTES } from "../report/report-export";
```

- [ ] **Step 2: Add export fixtures and failing integration tests**

Add these helpers after `makeLifecycleIssue`:

```ts
function makeLargeExportResult(): ScanResult {
	return makeScanResult([{
		...makeLifecycleIssue("large-export"),
		title: "Large export fixture",
		message: "x".repeat(MAX_SAFE_VAULT_REPORT_BYTES + 1),
	}]);
}

function makeExportSubject(result: ScanResult | null) {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const createFolder = vi.fn(async (_path: string) => {});
	const create = vi.fn(async (_path: string, _content: string) => {});
	const getAbstractFileByPath = vi.fn(() => null);
	const view = {
		hasResult: vi.fn(() => result !== null),
		getResult: vi.fn(() => result),
	};
	(plugin as any).app = {
		workspace: {
			getLeavesOfType: vi.fn(() => result === null ? [] : [{ view }]),
		},
		vault: { createFolder, create, getAbstractFileByPath },
	};
	return {
		plugin,
		createFolder,
		create,
		getAbstractFileByPath,
		view,
	};
}
```

Add a new `describe("report export safety", ...)` block before the existing helper functions:

```ts
describe("report export safety", () => {
	it("preserves the existing small full-report path without a modal", async () => {
		const { plugin, createFolder, create } = makeExportSubject(makeScanResult([]));

		await (plugin as any).exportReport();

		expect(showLargeReportWarningModalMock).not.toHaveBeenCalled();
		expect(createFolder).toHaveBeenCalledWith("Vault Inspector Reports");
		expect(create).toHaveBeenCalledOnce();
		expect(create.mock.calls[0][0]).toMatch(
			/^Vault Inspector Reports\/Vault Inspector Report .+\.md$/,
		);
		expect(create.mock.calls[0][1]).toContain("# Vault Inspector Report");
		expect(noticeMessages.at(-1)).toMatch(/^Report exported to /);
	});

	it("waits for a large-report decision before any vault mutation", async () => {
		const { plugin, createFolder, create } = makeExportSubject(makeLargeExportResult());
		let choose!: (value: "summary" | "full" | null) => void;
		showLargeReportWarningModalMock.mockReturnValue(new Promise((resolve) => {
			choose = resolve;
		}));

		const exporting = (plugin as any).exportReport();
		await vi.waitFor(() => expect(showLargeReportWarningModalMock).toHaveBeenCalledOnce());
		expect(showLargeReportWarningModalMock).toHaveBeenCalledWith(
			(plugin as any).app,
			{
				reportBytes: expect.any(Number),
				thresholdBytes: MAX_SAFE_VAULT_REPORT_BYTES,
				findingCount: 1,
			},
		);
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();

		choose("summary");
		await exporting;

		expect(create.mock.calls[0][0]).toMatch(
			/^Vault Inspector Reports\/Vault Inspector Summary .+\.md$/,
		);
		expect(create.mock.calls[0][1]).toContain("# Vault Inspector Summary");
		expect(create.mock.calls[0][1]).not.toContain("Large export fixture");
		expect(create.mock.calls[0][1].length).toBeLessThan(4096);
		expect(noticeMessages.at(-1)).toMatch(/^Summary exported to /);
	});

	it("writes the already-generated full report only after explicit acceptance", async () => {
		const { plugin, create } = makeExportSubject(makeLargeExportResult());
		showLargeReportWarningModalMock.mockResolvedValue("full");

		await (plugin as any).exportReport();

		expect(create).toHaveBeenCalledOnce();
		expect(create.mock.calls[0][0]).toMatch(
			/^Vault Inspector Reports\/Vault Inspector Report .+\.md$/,
		);
		expect(create.mock.calls[0][1]).toContain("Large export fixture");
		expect(new TextEncoder().encode(create.mock.calls[0][1]).byteLength)
			.toBeGreaterThan(MAX_SAFE_VAULT_REPORT_BYTES);
		expect(noticeMessages.at(-1)).toMatch(/^Report exported to /);
	});

	it("writes nothing when the large-report warning is cancelled", async () => {
		const { plugin, createFolder, create } = makeExportSubject(makeLargeExportResult());
		showLargeReportWarningModalMock.mockResolvedValue(null);

		await (plugin as any).exportReport();

		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual([]);
	});

	it("preserves the missing-result notice", async () => {
		const { plugin, createFolder, create } = makeExportSubject(null);

		await (plugin as any).exportReport();

		expect(showLargeReportWarningModalMock).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual(["Run a scan first before exporting."]);
	});

	it("reports modal failure without touching the vault", async () => {
		const { plugin, createFolder, create } = makeExportSubject(makeLargeExportResult());
		showLargeReportWarningModalMock.mockRejectedValue(new Error("modal unavailable"));

		await (plugin as any).exportReport();

		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual([
			"Report export failed: modal unavailable",
		]);
	});

	it.each([
		["folder", "folder unavailable"],
		["file", "file unavailable"],
	] as const)("reports %s write failure without a success notice", async (phase, message) => {
		const { plugin, createFolder, create } = makeExportSubject(makeScanResult([]));
		if (phase === "folder") createFolder.mockRejectedValue(new Error(message));
		if (phase === "file") create.mockRejectedValue(new Error(message));

		await (plugin as any).exportReport();

		expect(noticeMessages).toEqual([`Report export failed: ${message}`]);
	});
});
```

- [ ] **Step 3: Run the plugin tests and verify RED**

Run:

```bash
npm test -- src/tests/main.test.ts src/tests/report-export.test.ts src/tests/markdown-export.test.ts src/tests/export-warning-modal.test.ts
```

Expected: the new main tests FAIL because the export path neither invokes the warning modal nor catches export failures. Existing tests remain green.

- [ ] **Step 4: Implement the preflight orchestration**

Add these imports to `src/main.ts`:

```ts
import { showLargeReportWarningModal } from "./report/export-warning-modal";
import {
	getUtf8ByteLength,
	MAX_SAFE_VAULT_REPORT_BYTES,
	requiresLargeReportConfirmation,
} from "./report/report-export";
```

Replace `exportReport` with:

```ts
	private async exportReport() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSPECTOR);
		const view = leaves[0]?.view as unknown as InspectorView | undefined;
		if (!view || !view.hasResult()) {
			new Notice("Run a scan first before exporting.");
			return;
		}

		try {
			const result = view.getResult()!;
			const fullReport = generateMarkdownReport(result);
			let report = fullReport;
			let exportKind: "Report" | "Summary" = "Report";

			if (requiresLargeReportConfirmation(fullReport)) {
				const decision = await showLargeReportWarningModal(this.app, {
					reportBytes: getUtf8ByteLength(fullReport),
					thresholdBytes: MAX_SAFE_VAULT_REPORT_BYTES,
					findingCount: result.issues.length,
				});
				if (decision === null) return;
				if (decision === "summary") {
					report = generateMarkdownReport(result, "summary");
					exportKind = "Summary";
				}
			}

			const folder = this.settings.reportFolderPath;
			const now = new Date();
			const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const filename = `Vault Inspector ${exportKind} ${timestamp}.md`;
			const filepath = `${folder}/${filename}`;

			if (!this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
			await this.app.vault.create(filepath, report);
			new Notice(`${exportKind} exported to ${filepath}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Report export failed: ${message}`);
		}
	}
```

This intentionally replaces the blanket `createFolder(...).catch(() => {})`. Existing folders are detected with `getAbstractFileByPath`; real folder failures remain visible.

- [ ] **Step 5: Verify integration and no-mutation ordering**

Run:

```bash
npm test -- src/tests/main.test.ts src/tests/report-export.test.ts src/tests/markdown-export.test.ts src/tests/export-warning-modal.test.ts
npm run lint
npm run lint:obsidian-warnings
npm run build
git diff --check
```

Expected: all focused tests PASS; lint, warning lint, build, and diff check exit 0.

- [ ] **Step 6: Commit the guarded plugin path**

```bash
git add src/main.ts src/tests/main.test.ts
git commit -m "fix: guard large in-vault report exports"
```

---

### Task 5: Document the behavior and perform release-boundary verification

**Files:**
- Modify: `README.md:81-90,302-306`

- [ ] **Step 1: Update the user-facing export guidance**

Replace usage step 8 with:

```md
8. Run **Vault Inspector: Export report** to save results as Markdown. When a
   complete in-vault report would exceed 1 MiB, choose a compact summary,
   explicitly export the complete report anyway, or cancel.
```

After the paragraph ending with `scanner-specific detail fields.`, add:

```md
Plugin exports measure the complete Markdown output before writing into the
vault. Reports larger than 1 MiB require an explicit choice because large
Markdown files may make Obsidian unresponsive while indexing. Summary exports
keep scan totals and per-scanner counts but omit per-finding details. This
in-vault protection does not change CLI Markdown output.
```

Keep the settings table unchanged because the threshold is intentionally not configurable.

- [ ] **Step 2: Run focused compatibility tests**

Run:

```bash
npm test -- src/tests/report-export.test.ts src/tests/markdown-export.test.ts src/tests/export-warning-modal.test.ts src/tests/main.test.ts src/tests/cli.test.ts src/tests/cli-package.test.ts
```

Expected: all selected tests PASS. If the existing CLI loopback test is blocked by sandbox permissions, rerun the exact command where loopback binding is permitted.

- [ ] **Step 3: Run the complete verification gate**

Run each command and inspect its exit code and output:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm run test:coverage
npm pack --dry-run
git diff --check
```

Expected:

- lint and Obsidian warning lint: exit 0 with zero warnings;
- build: exit 0;
- tests: all files and tests pass;
- coverage: every configured threshold passes;
- package dry run: only the existing package assets are included;
- diff check: exit 0.

Do not weaken, skip, or modify the loopback SSRF test to make a restricted sandbox green. Rerun it with the required loopback permission.

- [ ] **Step 4: Inspect the complete branch scope**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git status --short
```

Expected tracked scope:

```text
README.md
docs/superpowers/plans/2026-08-14-large-report-export-safety.md
docs/superpowers/specs/2026-08-14-large-report-export-safety-design.md
src/main.ts
src/report/export-warning-modal.ts
src/report/markdown-export.ts
src/report/report-export.ts
src/tests/export-warning-modal.test.ts
src/tests/main.test.ts
src/tests/markdown-export.test.ts
src/tests/report-export.test.ts
```

The existing untracked `.zcode/` directory must remain untouched and unstaged. No manifest, package version, `versions.json`, CLI schema, workflow, generated bundle, or release file should be in the diff.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain safe large report exports"
```

- [ ] **Step 6: Perform the Obsidian runtime acceptance check**

Using a disposable vault or a sanitized fixture result:

1. Export a report below 1 MiB and confirm no modal appears.
2. Produce a complete report above 1 MiB and confirm no folder or file is created before the modal choice.
3. Select `Export summary only`; verify the filename begins `Vault Inspector Summary`, the file is small, counts are present, and per-finding details are absent.
4. Repeat and select `Cancel`; verify no file is created.
5. Repeat and select `Export full report anyway`; verify exactly one complete report is created and the success Notice names it as a report.
6. Close the modal with Escape; verify it behaves like Cancel.

Record the observed filenames and sizes in the task handoff. Do not use private paths or report contents in public artifacts.
