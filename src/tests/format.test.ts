import { describe, it, expect } from "vitest";
import { formatDuration, formatSize } from "../utils/format";

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

describe("formatDuration", () => {
	it("formats sub-second durations in milliseconds", () => {
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(87)).toBe("87ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	it("formats short second-level durations with one decimal", () => {
		expect(formatDuration(1000)).toBe("1.0s");
		expect(formatDuration(1549)).toBe("1.5s");
		expect(formatDuration(9900)).toBe("9.9s");
	});

	it("formats longer second-level durations as whole seconds", () => {
		expect(formatDuration(10_000)).toBe("10s");
		expect(formatDuration(59_400)).toBe("59s");
	});

	it("formats minute-level durations", () => {
		expect(formatDuration(60_000)).toBe("1m 00s");
		expect(formatDuration(125_400)).toBe("2m 05s");
	});
});
