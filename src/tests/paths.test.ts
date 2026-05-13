import { describe, it, expect } from "vitest";
import {
	normalizePath,
	getExtension,
	getBasename,
	isInFolder,
	isIgnoredPath,
} from "../utils/paths";

describe("normalizePath", () => {
	it("replaces backslashes with forward slashes", () => {
		expect(normalizePath("foo\\bar\\baz")).toBe("foo/bar/baz");
	});

	it("trims trailing slashes", () => {
		expect(normalizePath("foo/bar/")).toBe("foo/bar");
	});

	it("handles mixed separators", () => {
		expect(normalizePath("foo\\bar/baz/")).toBe("foo/bar/baz");
	});
});

describe("getExtension", () => {
	it("returns lowercase extension", () => {
		expect(getExtension("notes/file.MD")).toBe("md");
	});

	it("returns empty for no extension", () => {
		expect(getExtension("notes/README")).toBe("");
	});

	it("handles dots in directory names", () => {
		expect(getExtension("dir.name/file")).toBe("");
	});

	it("returns last extension for multiple dots", () => {
		expect(getExtension("archive.tar.gz")).toBe("gz");
	});
});

describe("getBasename", () => {
	it("returns filename without extension", () => {
		expect(getBasename("folder/note.md")).toBe("note");
	});

	it("handles no directory", () => {
		expect(getBasename("file.txt")).toBe("file");
	});

	it("handles no extension", () => {
		expect(getBasename("folder/README")).toBe("README");
	});
});

describe("isInFolder", () => {
	it("returns true for direct child", () => {
		expect(isInFolder("archive/old.md", "archive")).toBe(true);
	});

	it("returns true for nested child", () => {
		expect(isInFolder("archive/sub/old.md", "archive")).toBe(true);
	});

	it("returns false for non-matching path", () => {
		expect(isInFolder("notes/today.md", "archive")).toBe(false);
	});

	it("returns false for partial folder name match", () => {
		expect(isInFolder("archived/file.md", "archive")).toBe(false);
	});

	it("handles trailing slash in folder", () => {
		expect(isInFolder("archive/file.md", "archive/")).toBe(true);
	});
});

describe("isIgnoredPath", () => {
	it("returns true if path matches any ignored folder", () => {
		expect(isIgnoredPath("templates/note.md", ["templates", ".trash"])).toBe(true);
	});

	it("returns false if path matches no ignored folder", () => {
		expect(isIgnoredPath("notes/today.md", ["templates", ".trash"])).toBe(false);
	});

	it("returns false for empty ignored list", () => {
		expect(isIgnoredPath("any/path.md", [])).toBe(false);
	});
});
