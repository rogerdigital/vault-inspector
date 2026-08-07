export type ExternalHttpUrlAssessment =
	| { allowed: true; url: URL }
	| { allowed: false; reason: string };

const LOCAL_HOSTNAME_SUFFIXES = [
	".localhost",
	".local",
	".lan",
	".internal",
	".home.arpa",
];

export function assessExternalHttpUrl(value: string): ExternalHttpUrlAssessment {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { allowed: false, reason: "valid URL" };
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { allowed: false, reason: "HTTP(S)" };
	}
	if (url.username || url.password) {
		return { allowed: false, reason: "credentials" };
	}

	const hostname = normalizeHostname(url.hostname);
	if (isLocalHostname(hostname)) {
		return { allowed: false, reason: "local hostname" };
	}
	if (isPublicIpAddress(hostname) === false) {
		return { allowed: false, reason: "non-public IP address" };
	}

	return { allowed: true, url };
}

export function isPublicIpAddress(value: string): boolean | null {
	const normalized = normalizeHostname(value);
	const ipv4 = parseIpv4Address(normalized);
	if (ipv4) return isPublicIpv4(ipv4);

	const ipv6 = parseIpv6Address(normalized);
	if (ipv6) return isPublicIpv6(ipv6);

	return null;
}

function normalizeHostname(value: string): string {
	const withoutBrackets = value.startsWith("[") && value.endsWith("]")
		? value.slice(1, -1)
		: value;
	return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
	if (hostname === "localhost") return true;
	return LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function parseIpv4Address(value: string): [number, number, number, number] | null {
	const parts = value.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => {
		if (!/^\d{1,3}$/.test(part)) return Number.NaN;
		return Number(part);
	});
	if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return null;
	return octets as [number, number, number, number];
}

function isPublicIpv4([first, second, third]: [number, number, number, number]): boolean {
	if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
	if (first === 100 && second >= 64 && second <= 127) return false;
	if (first === 169 && second === 254) return false;
	if (first === 172 && second >= 16 && second <= 31) return false;
	if (first === 192 && second === 0 && third === 0) return false;
	if (first === 192 && second === 0 && third === 2) return false;
	if (first === 192 && second === 88 && third === 99) return false;
	if (first === 192 && second === 168) return false;
	if (first === 198 && (second === 18 || second === 19)) return false;
	if (first === 198 && second === 51 && third === 100) return false;
	if (first === 203 && second === 0 && third === 113) return false;
	return true;
}

function parseIpv6Address(value: string): number[] | null {
	const zoneIndex = value.indexOf("%");
	const address = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
	if (!address.includes(":")) return null;

	const doubleColonParts = address.split("::");
	if (doubleColonParts.length > 2) return null;

	const left = parseIpv6Section(doubleColonParts[0]);
	const right = doubleColonParts.length === 2
		? parseIpv6Section(doubleColonParts[1])
		: [];
	if (!left || !right) return null;

	if (doubleColonParts.length === 1) {
		return left.length === 8 ? left : null;
	}

	const missing = 8 - left.length - right.length;
	if (missing < 1) return null;
	return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseIpv6Section(section: string): number[] | null {
	if (!section) return [];
	const parts = section.split(":");
	const words: number[] = [];

	for (const part of parts) {
		if (part.includes(".")) {
			const ipv4 = parseIpv4Address(part);
			if (!ipv4) return null;
			words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
			continue;
		}
		if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
		words.push(Number.parseInt(part, 16));
	}

	return words;
}

function isPublicIpv6(words: number[]): boolean {
	const isIpv4Mapped = words.slice(0, 5).every((word) => word === 0)
		&& words[5] === 0xffff;
	if (isIpv4Mapped) {
		return isPublicIpv4([
			words[6] >> 8,
			words[6] & 0xff,
			words[7] >> 8,
			words[7] & 0xff,
		]);
	}

	if (words.slice(0, 6).every((word) => word === 0)) return false;
	if ((words[0] & 0xfe00) === 0xfc00) return false;
	if ((words[0] & 0xffc0) === 0xfe80) return false;
	if ((words[0] & 0xffc0) === 0xfec0) return false;
	if ((words[0] & 0xff00) === 0xff00) return false;
	if (words[0] === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return false;
	if (words[0] === 0x2001 && words[1] === 0x0002) return false;
	if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0010) return false;
	if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
	if ((words[0] & 0xfff0) === 0x3ff0) return false;
	if (words[0] === 0x5f00) return false;
	return true;
}
