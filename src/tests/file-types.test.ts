import { describe, it, expect } from "vitest";
import { isAttachment, isMarkdown } from "../utils/file-types";

describe("isAttachment", () => {
	it("returns true for image files", () => {
		expect(isAttachment("photos/img.png")).toBe(true);
		expect(isAttachment("photos/photo.jpg")).toBe(true);
		expect(isAttachment("photos/anim.gif")).toBe(true);
		expect(isAttachment("photos/vector.svg")).toBe(true);
		expect(isAttachment("photos/modern.webp")).toBe(true);
	});

	it("returns true for media and archive files", () => {
		expect(isAttachment("files/doc.pdf")).toBe(true);
		expect(isAttachment("files/song.mp3")).toBe(true);
		expect(isAttachment("files/video.mp4")).toBe(true);
		expect(isAttachment("files/audio.wav")).toBe(true);
		expect(isAttachment("files/clip.mov")).toBe(true);
		expect(isAttachment("files/bundle.zip")).toBe(true);
	});

	it("returns false for markdown files", () => {
		expect(isAttachment("notes/daily.md")).toBe(false);
	});

	it("returns false for unknown extensions", () => {
		expect(isAttachment("data/export.csv")).toBe(false);
	});

	it("returns false for files without extension", () => {
		expect(isAttachment("folder/README")).toBe(false);
	});
});

describe("isMarkdown", () => {
	it("returns true for .md files", () => {
		expect(isMarkdown("notes/daily.md")).toBe(true);
	});

	it("returns false for non-md files", () => {
		expect(isMarkdown("photos/img.png")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(isMarkdown("notes/note.MD")).toBe(true);
	});
});
