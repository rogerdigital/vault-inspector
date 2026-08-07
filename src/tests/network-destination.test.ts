import { describe, expect, it } from "vitest";
import {
	assessExternalHttpUrl,
	isPublicIpAddress,
} from "../utils/network-destination";

describe("assessExternalHttpUrl", () => {
	it.each([
		"https://example.com/path",
		"http://8.8.8.8/",
		"https://[2606:4700:4700::1111]/",
	])("allows public HTTP(S) destination %s", (value) => {
		const result = assessExternalHttpUrl(value);

		expect(result).toEqual(expect.objectContaining({ allowed: true }));
	});

	it.each([
		["http://user:pass@example.com/", "credentials"],
		["http://localhost/", "local hostname"],
		["http://api.localhost/", "local hostname"],
		["http://device.local/", "local hostname"],
		["http://router.lan/", "local hostname"],
		["http://service.internal/", "local hostname"],
		["http://host.home.arpa/", "local hostname"],
		["http://127.0.0.1/", "non-public IP address"],
		["http://2130706433/", "non-public IP address"],
		["http://10.0.0.1/", "non-public IP address"],
		["http://169.254.169.254/latest/meta-data/", "non-public IP address"],
		["http://192.168.1.1/", "non-public IP address"],
		["http://[::1]/", "non-public IP address"],
		["http://[fd00::1]/", "non-public IP address"],
		["http://[fe80::1]/", "non-public IP address"],
		["http://[::ffff:127.0.0.1]/", "non-public IP address"],
		["ftp://example.com/", "HTTP(S)"],
		["http://", "valid URL"],
	])("blocks %s with a stable reason", (value, reason) => {
		const result = assessExternalHttpUrl(value);

		expect(result).toEqual({ allowed: false, reason });
	});
});

describe("isPublicIpAddress", () => {
	it.each([
		["8.8.8.8", true],
		["127.0.0.1", false],
		["100.64.0.1", false],
		["172.16.0.1", false],
		["192.0.2.1", false],
		["198.18.0.1", false],
		["224.0.0.1", false],
		["2606:4700:4700::1111", true],
		["::", false],
		["::1", false],
		["fc00::1", false],
		["fec0::1", false],
		["ff02::1", false],
		["2001:db8::1", false],
		["example.com", null],
	] as const)("classifies %s", (value, expected) => {
		expect(isPublicIpAddress(value)).toBe(expected);
	});
});
