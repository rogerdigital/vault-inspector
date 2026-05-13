import { describe, it, expect } from "vitest";
import { generateFingerprint } from "../scanner/issue-fingerprint";

describe("generateFingerprint", () => {
	it("produces the same fingerprint for identical inputs", () => {
		const evidence = { path: "notes/test.md", link: "[[Missing]]" };
		const a = generateFingerprint("broken-links", "notes/test.md", evidence);
		const b = generateFingerprint("broken-links", "notes/test.md", evidence);
		expect(a).toBe(b);
	});

	it("changes when scanner ID differs", () => {
		const evidence = { path: "notes/test.md" };
		const a = generateFingerprint("broken-links", "notes/test.md", evidence);
		const b = generateFingerprint("orphan-attachments", "notes/test.md", evidence);
		expect(a).not.toBe(b);
	});

	it("changes when primary path differs", () => {
		const evidence = { size: 1024 };
		const a = generateFingerprint("large-files", "big.md", evidence);
		const b = generateFingerprint("large-files", "other.md", evidence);
		expect(a).not.toBe(b);
	});

	it("is stable regardless of evidence key insertion order", () => {
		const a = generateFingerprint("broken-links", "a.md", { x: "1", y: "2" });
		const b = generateFingerprint("broken-links", "a.md", { y: "2", x: "1" });
		expect(a).toBe(b);
	});

	it("changes when evidence values differ", () => {
		const a = generateFingerprint("tag-usage", undefined, { tag: "foo" });
		const b = generateFingerprint("tag-usage", undefined, { tag: "bar" });
		expect(a).not.toBe(b);
	});

	it("produces unique fingerprints across many inputs", () => {
		const fingerprints = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			fingerprints.add(
				generateFingerprint("broken-links", `notes/file-${i}.md`, { link: `target-${i}` }),
			);
		}
		expect(fingerprints.size).toBe(1000);
	});
});
