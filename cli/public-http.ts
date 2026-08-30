import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
	assessExternalHttpUrl,
	isPublicIpAddress,
} from "../src/utils/network-destination";
import type {
	ExternalHttpMethod,
	ExternalRequestResult,
} from "../src/scanner/ScanContext";

export type ResolvedAddress = {
	address: string;
	family: 4 | 6;
};

type AdapterResponse = {
	status: number;
	location?: string;
};

export type PublicHttpDependencies = {
	resolve: (hostname: string) => Promise<ResolvedAddress[]>;
	request: (
		url: URL,
		address: ResolvedAddress,
		method: ExternalHttpMethod,
		signal?: AbortSignal,
	) => Promise<AdapterResponse>;
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEAD_REJECTED_STATUSES = new Set([405, 501]);
/** One-byte Range request: the fallback proves reachability only. */
const RANGE_GET_BYTES = "bytes=0-0";

const defaultDependencies: PublicHttpDependencies = {
	resolve: resolveHostname,
	request: requestAtAddress,
};

export async function requestPublicHttpStatus(
	value: string,
	signal?: AbortSignal,
	dependencies: PublicHttpDependencies = defaultDependencies,
): Promise<ExternalRequestResult> {
	let current = value;

	for (let redirects = 0; ; redirects++) {
		// Every destination — the initial URL and every redirect target —
		// re-runs the URL policy and DNS/public-IP validation before a
		// connection is opened.
		const assessment = assessExternalHttpUrl(current);
		if (!assessment.allowed) {
			throw new Error(`Blocked URL: ${assessment.reason}`);
		}

		const address = await getValidatedAddress(assessment.url, dependencies);
		const response = await dependencies.request(assessment.url, address, "HEAD", signal);
		if (HEAD_REJECTED_STATUSES.has(response.status)) {
			return requestWithRangeGetFallback(current, dependencies, signal);
		}
		if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
			return { status: response.status, method: "HEAD" };
		}
		if (redirects >= MAX_REDIRECTS) {
			throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`);
		}

		try {
			current = new URL(response.location, assessment.url).href;
		} catch {
			throw new Error("Invalid redirect URL");
		}
	}
}

/**
 * Some origins reject HEAD with 405/501. Retry once with a one-byte Range
 * GET. The fallback re-runs the full URL and DNS/public-IP policy for the
 * destination before connecting; the response body is discarded. A redirect
 * status from the GET is returned as-is (a redirecting GET answer still
 * proves the origin serves the resource).
 */
async function requestWithRangeGetFallback(
	url: string,
	dependencies: PublicHttpDependencies,
	signal?: AbortSignal,
): Promise<ExternalRequestResult> {
	const assessment = assessExternalHttpUrl(url);
	if (!assessment.allowed) {
		throw new Error(`Blocked URL: ${assessment.reason}`);
	}

	const address = await getValidatedAddress(assessment.url, dependencies);
	const response = await dependencies.request(assessment.url, address, "GET", signal);
	return { status: response.status, method: "GET" };
}

async function getValidatedAddress(
	url: URL,
	dependencies: PublicHttpDependencies,
): Promise<ResolvedAddress> {
	const hostname = stripIpv6Brackets(url.hostname);
	const literalClassification = isPublicIpAddress(hostname);
	if (literalClassification === true) {
		return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
	}

	const addresses = await dependencies.resolve(hostname);
	if (addresses.length === 0) {
		throw new Error("DNS returned no addresses");
	}
	if (addresses.some(({ address }) => isPublicIpAddress(address) !== true)) {
		throw new Error("DNS resolved to a non-public IP address");
	}

	return addresses[0];
}

async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
	const addresses = await lookup(hostname, { all: true, verbatim: true });
	return addresses.map(({ address, family }) => {
		if (family !== 4 && family !== 6) {
			throw new Error(`Unsupported DNS address family: ${family}`);
		}
		return { address, family };
	});
}

function requestAtAddress(
	url: URL,
	address: ResolvedAddress,
	method: ExternalHttpMethod,
	signal?: AbortSignal,
): Promise<AdapterResponse> {
	return new Promise((resolve, reject) => {
		const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
		const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
			if (options.all) {
				callback(null, [address]);
				return;
			}
			callback(null, address.address, address.family);
		};
		const request = transport(url, {
			method,
			signal,
			lookup: pinnedLookup,
			headers: method === "GET" ? { Range: RANGE_GET_BYTES } : undefined,
		}, (response: IncomingMessage) => {
			const result: AdapterResponse = {
				status: response.statusCode ?? 0,
			};
			if (response.headers.location) result.location = response.headers.location;
			// The body is consumed and discarded — never materialized.
			response.resume();
			resolve(result);
		});
		request.on("error", reject);
		request.end();
	});
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}
