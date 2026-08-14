import { describe, expect, test } from "vitest";
import {
	getUtf8ByteLength,
	MAX_SAFE_VAULT_REPORT_BYTES,
	requiresLargeReportConfirmation,
} from "../report/report-export";

describe("large report export policy", () => {
	test("measures ASCII UTF-8 byte length", () => {
		expect(getUtf8ByteLength("A")).toBe(1);
	});

	test("measures Chinese UTF-8 byte length", () => {
		expect(getUtf8ByteLength("中")).toBe(3);
	});

	test("measures emoji UTF-8 byte length", () => {
		expect(getUtf8ByteLength("🙂")).toBe(4);
	});

	test("measures mixed UTF-8 byte length", () => {
		expect(getUtf8ByteLength("A中🙂")).toBe(8);
	});

	test("does not require confirmation at the safe report size limit", () => {
		expect(requiresLargeReportConfirmation("A".repeat(MAX_SAFE_VAULT_REPORT_BYTES))).toBe(false);
	});

	test("requires confirmation above the safe report size limit", () => {
		expect(requiresLargeReportConfirmation("A".repeat(MAX_SAFE_VAULT_REPORT_BYTES + 1))).toBe(true);
	});
});
