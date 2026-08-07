import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
	assessExternalHttpUrl,
	isPublicIpAddress,
} from "../src/utils/network-destination";

export type ResolvedAddress = {
	address: string;
	family: 4 | 6;
};

type HeadResponse = {
	status: number;
	location?: string;
};

export type PublicHttpDependencies = {
	resolve: (hostname: string) => Promise<ResolvedAddress[]>;
	request: (
		url: URL,
		address: ResolvedAddress,
		signal?: AbortSignal,
	) => Promise<HeadResponse>;
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultDependencies: PublicHttpDependencies = {
	resolve: resolveHostname,
	request: requestHeadAtAddress,
};

export async function requestPublicHttpStatus(
	value: string,
	signal?: AbortSignal,
	dependencies: PublicHttpDependencies = defaultDependencies,
): Promise<number> {
	let current = value;

	for (let redirects = 0; ; redirects++) {
		const assessment = assessExternalHttpUrl(current);
		if (!assessment.allowed) {
			throw new Error(`Blocked URL: ${assessment.reason}`);
		}

		const address = await getValidatedAddress(assessment.url, dependencies);
		const response = await dependencies.request(assessment.url, address, signal);
		if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
			return response.status;
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

function requestHeadAtAddress(
	url: URL,
	address: ResolvedAddress,
	signal?: AbortSignal,
): Promise<HeadResponse> {
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
			method: "HEAD",
			signal,
			lookup: pinnedLookup,
		}, (response: IncomingMessage) => {
			const result: HeadResponse = {
				status: response.statusCode ?? 0,
			};
			if (response.headers.location) result.location = response.headers.location;
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
