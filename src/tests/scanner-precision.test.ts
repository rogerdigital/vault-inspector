import { describe, expect, it } from "vitest";
import { scanFixtureVault } from "./helpers/fixture-vault";
import type { Issue } from "../scanner/Issue";
import { DEFAULT_SETTINGS } from "../settings/settings";

function inventoryLine(issue: Issue): string {
	return [
		issue.scannerId,
		issue.severity,
		issue.classification,
		[issue.primaryPath ?? "", ...issue.relatedPaths].sort().join(","),
		issue.message,
	].join(" | ");
}

function inventoryOf(issues: Issue[]): string[] {
	return issues.map(inventoryLine).sort();
}

// Kept in true sorted order (matches inventoryOf output) so the snapshot
// comparison doubles as an ordering pin.
const EXPECTED_INVENTORY: string[] = [
	"broken-links | error | confirmed | Missing Note,notes/hub/broken-links.md | Linked file not found: Missing Note",
	"broken-links | error | confirmed | missing-embed.png,notes/hub/broken-links.md | Attachment not found: missing-embed.png",
	"broken-links | error | confirmed | missing-photo.png,notes/hub/broken-links.md | Attachment not found: missing-photo.png",
	"broken-links | error | confirmed | missing-target.md,notes/hub/broken-links.md | Linked file not found: missing-target.md",
	"broken-links | warning | confirmed | notes/hub/broken-links.md,notes/target.md | Heading \"#Missing Heading\" not found in notes/target.md",
	"duplicate-files | info | candidate | ,duplicates/archive/notes-a.txt,duplicates/notes-a.txt | 2 files share the name \"notes-a.txt\"",
	"duplicate-files | info | candidate | ,duplicates/size-twin-one.bin,duplicates/size-twin-two.bin | 2 files share size 48 B",
	"duplicate-files | warning | confirmed | ,duplicates/backup/fixture-data.bin,duplicates/original/fixture-data.bin | 2 files have identical content",
	"empty-notes | warning | candidate | notes/empty/cjk-stub.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/embed-only.md | This note only has 1 word (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/frontmatter-only.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/genuine-empty.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/short-link-moc.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/stub.md | This note only has 3 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/task-note.md | This note only has 5 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/title-only.md | This note has no content besides a title",
	"orphan-attachments | info | candidate | attachments/recent-orphan.png | This attachment is not referenced by any note",
	"orphan-attachments | warning | candidate | attachments/canvas-image.png | This attachment is not referenced by any note",
	"orphan-attachments | warning | candidate | attachments/orphan.png | This attachment is not referenced by any note",
];

const scanWithRecentOrphan = (now: number = Date.now()) =>
	scanFixtureVault({
		mtimeOverrides: {
			"attachments/recent-orphan.png": now - 60_000,
		},
	});

describe("precision fixture vault", () => {
	it("loads the fixture vault through the CLI adapter and runs seven scanners", async () => {
		const { result, issues } = await scanFixtureVault();

		expect(result.filesScanned).toBe(31);
		expect(result.scannersRun).toHaveLength(7);
		expect(result.scannersRun).not.toContain("external-links");
		expect(issues.length).toBeGreaterThan(0);
	});

	describe("broken links", () => {
		it("reports nothing for the valid-links note", async () => {
			const { issues } = await scanFixtureVault();
			const fromValid = issues.filter(
				(issue) => issue.primaryPath === "notes/hub/valid-links.md",
			);
			expect(fromValid).toEqual([]);
		});

		it("reports nothing for the relative-and-unicode note", async () => {
			const { issues } = await scanFixtureVault();
			const fromUnicode = issues.filter(
				(issue) => issue.primaryPath === "notes/hub/relative-and-unicode.md",
			);
			expect(fromUnicode).toEqual([]);
		});

		it("reports five findings for the broken-links note with current fix availability", async () => {
			const { issues } = await scanFixtureVault();
			const broken = issues.filter(
				(issue) =>
					issue.scannerId === "broken-links" &&
					issue.primaryPath === "notes/hub/broken-links.md",
			);
			expect(broken).toHaveLength(5);
			expect(broken.every((issue) => issue.classification === "confirmed")).toBe(true);

			const byLink = new Map(broken.map((issue) => [issue.evidence.link, issue]));

			// The plain and aliased references merge into one finding (Obsidian's
			// cache strips aliases from LinkCache.link); document order makes the
			// plain reference's fix text win.
			expect(byLink.get("Missing Note")).toMatchObject({
				message: "Linked file not found: Missing Note",
				severity: "error",
				evidence: { link: "Missing Note", target: "Missing Note" },
				fixAction: { kind: "remove-link-text", linkText: "Missing Note" },
			});
			expect(byLink.has("Missing Note|Readable Label")).toBe(false);
			// Markdown links currently get no fix action — Milestone 1.5 target.
			expect(byLink.get("missing-target.md")).toMatchObject({
				message: "Linked file not found: missing-target.md",
				severity: "error",
			});
			expect(byLink.get("missing-target.md")?.fixAction).toBeUndefined();
			expect(byLink.get("missing-photo.png")).toMatchObject({
				message: "Attachment not found: missing-photo.png",
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(byLink.get("missing-embed.png")).toMatchObject({
				message: "Attachment not found: missing-embed.png",
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(byLink.get("target#Missing Heading")).toMatchObject({
				message: 'Heading "#Missing Heading" not found in notes/target.md',
				severity: "warning",
				relatedPaths: ["notes/target.md"],
				fixAction: { kind: "remove-link-text", linkText: "target#Missing Heading" },
			});
		});
	});

	describe("orphan attachments", () => {
		const scanOrphans = () =>
			scanWithRecentOrphan().then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "orphan-attachments"),
			);

		it("reports exactly the three unreferenced attachments as candidates", async () => {
			const orphans = await scanOrphans();
			expect(orphans).toHaveLength(3);
			expect(orphans.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(orphans.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
			expect(orphans.map((issue) => issue.primaryPath).sort()).toEqual([
				"attachments/canvas-image.png",
				"attachments/orphan.png",
				"attachments/recent-orphan.png",
			]);
		});

		it("keeps the Canvas-only reference as an orphan — known false positive boundary", async () => {
			const orphans = await scanOrphans();
			const canvasOrphan = orphans.find(
				(issue) => issue.primaryPath === "attachments/canvas-image.png",
			);
			// Canvas references are outside the current scan boundary (Milestone 1 target).
			expect(canvasOrphan?.severity).toBe("warning");
			expect(canvasOrphan?.explanation.caveat).toContain("Canvas");
		});

		it("downgrades the recently modified orphan to info severity", async () => {
			const orphans = await scanOrphans();
			const recent = orphans.find(
				(issue) => issue.primaryPath === "attachments/recent-orphan.png",
			);
			expect(recent?.severity).toBe("info");
		});

		it("does not report Markdown, frontmatter, or Unicode referenced attachments", async () => {
			const orphans = await scanOrphans();
			const referenced = [
				"attachments/photo.jpg",
				"attachments/frontmatter-doc.pdf",
				"attachments/目标图片.png",
			];
			expect(
				orphans.some((issue) => referenced.includes(issue.primaryPath ?? "")),
			).toBe(false);
		});
	});

	describe("empty notes", () => {
		it("reports the eight stub notes as warning candidates with trash actions", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			expect(empty.map((issue) => issue.primaryPath).sort()).toEqual([
				"notes/empty/cjk-stub.md",
				"notes/empty/embed-only.md",
				"notes/empty/frontmatter-only.md",
				"notes/empty/genuine-empty.md",
				"notes/empty/short-link-moc.md",
				"notes/empty/stub.md",
				"notes/empty/task-note.md",
				"notes/empty/title-only.md",
			]);
			expect(empty.every((issue) => issue.severity === "warning")).toBe(true);
			expect(empty.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(empty.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
		});

		it("keeps structural notes out of the findings — MOC, code note pass today", async () => {
			const { issues } = await scanFixtureVault();
			const emptyPaths = issues
				.filter((issue) => issue.scannerId === "empty-notes")
				.map((issue) => issue.primaryPath);
			expect(emptyPaths).not.toContain("notes/empty/link-only-moc.md");
			expect(emptyPaths).not.toContain("notes/empty/code-note.md");
		});

		it("pins the known false positives with their word counts", async () => {
			const { issues } = await scanFixtureVault();
			const wordCountByPath = new Map(
				issues
					.filter((issue) => issue.scannerId === "empty-notes")
					.map((issue) => [issue.primaryPath, issue.evidence.wordCount]),
			);
			// Link-only, embed-only, and task-only notes are reported today
			// purely by prose word count (Milestone 1.4 target).
			expect(wordCountByPath.get("notes/empty/short-link-moc.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/embed-only.md")).toBe(1);
			expect(wordCountByPath.get("notes/empty/task-note.md")).toBe(5);
			expect(wordCountByPath.get("notes/empty/cjk-stub.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/stub.md")).toBe(3);
		});
	});

	describe("duplicate files", () => {
		it("confirms the hash-identical pair and keeps the lexicographically first path", async () => {
			const { issues } = await scanFixtureVault();
			const hashIssues = issues.filter(
				(issue) => issue.title === "Duplicate files (hash-identical)",
			);
			expect(hashIssues).toHaveLength(1);
			const issue = hashIssues[0];
			expect(issue.severity).toBe("warning");
			expect(issue.classification).toBe("confirmed");
			expect([...issue.relatedPaths].sort()).toEqual([
				"duplicates/backup/fixture-data.bin",
				"duplicates/original/fixture-data.bin",
			]);
			expect(issue.fixAction).toMatchObject({
				kind: "trash-file",
				targetPaths: ["duplicates/original/fixture-data.bin"],
				selection: {
					kind: "keep-one",
					automaticKeepPath: "duplicates/backup/fixture-data.bin",
				},
			});
		});

		it("reports same-name and same-size pairs as info candidates without fix actions", async () => {
			const { issues } = await scanFixtureVault();
			const candidates = issues.filter(
				(issue) =>
					issue.scannerId === "duplicate-files" &&
					issue.classification === "candidate",
			);
			expect(candidates).toHaveLength(2);
			expect(candidates.every((issue) => issue.severity === "info")).toBe(true);
			expect(candidates.every((issue) => issue.fixAction === undefined)).toBe(true);
			expect(candidates.map((issue) => issue.message).sort()).toEqual([
				"2 files share size 48 B",
				`2 files share the name "notes-a.txt"`,
			]);
		});
	});

	describe("external links", () => {
		const EXTERNAL_STATUS_BY_URL: Record<string, number> = {
			"https://status-200.example.com/ok": 200,
			"https://status-404.example.com/gone": 404,
			"https://status-403.example.com/private": 403,
			"https://status-429.example.com/slow-down": 429,
			"https://status-500.example.com/server-error": 500,
		};

		const stubRequestUrl = async (url: string): Promise<number> => {
			if (url === "https://request-error.example.com/network-failure") {
				throw new Error("simulated network failure");
			}
			const status = EXTERNAL_STATUS_BY_URL[url];
			if (status === undefined) {
				throw new Error(
					`unexpected URL in external fixture: ${url} (expected one of: ${Object.keys(EXTERNAL_STATUS_BY_URL).join(", ")})`,
				);
			}
			return status;
		};

		const externalScan = () =>
			scanFixtureVault({
				requestUrl: stubRequestUrl,
				settings: {
					enabledScanners: {
						...DEFAULT_SETTINGS.enabledScanners,
						"external-links": true,
					},
				},
			}).then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "external-links"),
			);

		it("presents every >= 400 status as the same dead-link candidate — Milestone 1.6 target", async () => {
			const external = await externalScan();
			const dead = external.filter((issue) => issue.title === "Dead external link");
			expect(dead).toHaveLength(4);
			const byUrl = new Map(dead.map((issue) => [issue.evidence.url as string, issue]));
			expect(byUrl.size).toBe(4);
			expect(
				byUrl.get("https://status-403.example.com/private"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 403 },
			});
			expect(byUrl.get("https://status-404.example.com/gone")).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 404 },
			});
			expect(
				byUrl.get("https://status-429.example.com/slow-down"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 429 },
			});
			expect(
				byUrl.get("https://status-500.example.com/server-error"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 500 },
			});
			expect(dead.every((issue) => issue.primaryPath === "notes/external-links.md")).toBe(true);
		});

		it("stays silent for the healthy URL", async () => {
			const external = await externalScan();
			expect(
				external.some(
					(issue) => issue.evidence.url === "https://status-200.example.com/ok",
				),
			).toBe(false);
		});

		it("marks request failures and blocked destinations as unverified", async () => {
			const external = await externalScan();
			const unverified = external.filter(
				(issue) => issue.classification === "unverified",
			);
			expect(unverified).toHaveLength(2);
			expect(unverified.every((issue) => issue.severity === "info")).toBe(true);
			const failed = unverified.find(
				(issue) => issue.evidence.url === "https://request-error.example.com/network-failure",
			);
			expect(failed?.title).toBe("External link check failed");
			const blocked = unverified.find(
				(issue) => issue.evidence.url === "http://127.0.0.1:9/internal-service",
			);
			expect(blocked?.title).toBe("External link check blocked");
			expect(blocked?.evidence.blocked).toBe(true);
		});
	});

	describe("duplicate hash cap", () => {
		it("degrades the hash pair to a same-name candidate when below-cap hashing is impossible", async () => {
			const { issues } = await scanFixtureVault({
				settings: { duplicateHashMaxBytes: 8 },
			});
			const duplicates = issues.filter(
				(issue) => issue.scannerId === "duplicate-files",
			);
			expect(
				duplicates.some(
					(issue) => issue.title === "Duplicate files (hash-identical)",
				),
			).toBe(false);
			const capped = duplicates.find(
				(issue) => issue.message === `2 files share the name "fixture-data.bin"`,
			);
			expect(capped).toMatchObject({
				severity: "info",
				classification: "candidate",
			});
			expect(capped?.fixAction).toBeUndefined();
			expect([...capped?.relatedPaths ?? []].sort()).toEqual([
				"duplicates/backup/fixture-data.bin",
				"duplicates/original/fixture-data.bin",
			]);
			// Below-cap hashing is skipped entirely, so the pair degrades to both a
			// same-name and a same-size candidate; the two pre-existing candidate
			// groups (notes-a name, 48 B size) are unaffected.
			expect(duplicates).toHaveLength(4);
			expect(duplicates.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(
				duplicates.some((issue) => issue.message === "2 files share size 57 B"),
			).toBe(true);
			expect(duplicates.every((issue) => issue.severity === "info")).toBe(true);
		});
	});

	describe("inventory snapshot", () => {
		it("matches the documented v0.6.0 findings exactly", async () => {
			const { issues } = await scanWithRecentOrphan();
			expect(inventoryOf(issues)).toEqual(EXPECTED_INVENTORY);
		});

		it("produces identical findings and fingerprints on a repeat scan", async () => {
			const now = Date.now();
			const first = await scanWithRecentOrphan(now);
			const second = await scanWithRecentOrphan(now);
			expect(inventoryOf(second.issues)).toEqual(inventoryOf(first.issues));
			expect(
				second.issues.map((issue) => `${issue.fingerprint}:${issue.evidence.lastModified ?? ""}`),
			).toEqual(
				first.issues.map((issue) => `${issue.fingerprint}:${issue.evidence.lastModified ?? ""}`),
			);
		});
	});
});
