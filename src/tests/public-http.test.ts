import { describe, expect, it, vi } from "vitest";
import {
	requestPublicHttpStatus,
	type PublicHttpDependencies,
} from "../../cli/public-http";

function makeDependencies(
	overrides: Partial<PublicHttpDependencies> = {},
): PublicHttpDependencies {
	return {
		resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
		request: vi.fn(async () => ({ status: 200 })),
		...overrides,
	};
}

describe("requestPublicHttpStatus", () => {
	it("rejects private DNS answers before opening a connection", async () => {
		const dependencies = makeDependencies({
			resolve: vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/",
			undefined,
			dependencies,
		)).rejects.toThrow("DNS resolved to a non-public IP address");
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it("fails closed when DNS returns a mix of public and private addresses", async () => {
		const dependencies = makeDependencies({
			resolve: vi.fn(async () => [
				{ address: "93.184.216.34", family: 4 as const },
				{ address: "10.0.0.1", family: 4 as const },
			]),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/",
			undefined,
			dependencies,
		)).rejects.toThrow("DNS resolved to a non-public IP address");
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it("pins the request to the validated public address", async () => {
		const dependencies = makeDependencies({
			resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
			request: vi.fn(async () => ({ status: 204 })),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/health",
			undefined,
			dependencies,
		)).resolves.toBe(204);
		expect(dependencies.request).toHaveBeenCalledWith(
			expect.objectContaining({ hostname: "example.com", pathname: "/health" }),
			{ address: "93.184.216.34", family: 4 },
			undefined,
		);
	});

	it("revalidates a relative redirect before the next request", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 302, location: "/moved" })
			.mockResolvedValueOnce({ status: 200 });
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).resolves.toBe(200);
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ href: "https://example.com/moved" }),
			{ address: "93.184.216.34", family: 4 },
			undefined,
		);
	});

	it("blocks a public-to-private redirect before a second request", async () => {
		const request = vi.fn(async () => ({
			status: 302,
			location: "http://127.0.0.1/admin",
		}));
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).rejects.toThrow("Blocked URL: non-public IP address");
		expect(request).toHaveBeenCalledTimes(1);
		expect(dependencies.resolve).toHaveBeenCalledTimes(1);
	});

	it("limits redirect chains to five hops", async () => {
		const request = vi.fn(async () => ({ status: 302, location: "/again" }));
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).rejects.toThrow("Too many redirects");
		expect(request).toHaveBeenCalledTimes(6);
	});

	it("passes the caller's abort signal to the pinned request", async () => {
		const controller = new AbortController();
		const request = vi.fn(async () => ({ status: 200 }));
		const dependencies = makeDependencies({ request });

		await requestPublicHttpStatus(
			"https://example.com/",
			controller.signal,
			dependencies,
		);

		expect(request).toHaveBeenCalledWith(
			expect.any(URL),
			{ address: "93.184.216.34", family: 4 },
			controller.signal,
		);
	});
});
