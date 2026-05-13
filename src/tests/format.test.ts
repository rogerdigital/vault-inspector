import { describe, it, expect } from "vitest";
import { formatSize } from "../utils/format";

describe("formatSize", () => {
	it("formats bytes", () => {
		expect(formatSize(512)).toBe("512 B");
	});

	it("formats kilobytes", () => {
		expect(formatSize(1024)).toBe("1.0 KB");
		expect(formatSize(1536)).toBe("1.5 KB");
	});

	it("formats megabytes", () => {
		expect(formatSize(1048576)).toBe("1.0 MB");
		expect(formatSize(5242880)).toBe("5.0 MB");
	});

	it("handles zero", () => {
		expect(formatSize(0)).toBe("0 B");
	});
});
