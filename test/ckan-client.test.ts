import { describe, expect, it, vi } from "vitest";
import { buildActionUrl, CkanClient, CkanError, parseResponse } from "../src/ckan-client.js";

const site = { alias: "nso", baseUrl: "https://catalog.nso.go.th" };
const signal = new AbortController().signal;

function errorOf(fn: () => unknown): CkanError {
  try {
    fn();
  } catch (error) {
    return error as CkanError;
  }
  throw new Error("expected an error");
}

describe("buildActionUrl", () => {
  it("JSON-encodes objects and skips undefined", () => {
    const url = buildActionUrl(site, "datastore_search", { filters: { region: "ภาคเหนือ" }, q: undefined, limit: 5 });
    expect(url.pathname).toBe("/api/3/action/datastore_search");
    expect(url.searchParams.get("filters")).toBe('{"region":"ภาคเหนือ"}');
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("5");
  });
});

describe("parseResponse", () => {
  it("returns the result of a successful envelope", () => {
    expect(parseResponse(site, "a", 200, '{"success":true,"result":[1]}')).toEqual([1]);
  });

  it.each([
    [404, "Not Found Error", "not_found"],
    [403, "Authorization Error", "forbidden"]
  ])("classifies a JSON %i by __type, not by its Thai message", (status, type, kind) => {
    const body = JSON.stringify({ success: false, error: { __type: type, message: "ไม่พบ" } });
    const error = errorOf(() => parseResponse(site, "package_show", status, body));
    expect(error.kind).toBe(kind);
    expect(error.message).toContain("ไม่พบ");
  });

  it("keeps validation fields", () => {
    const body = JSON.stringify({ success: false, error: { __type: "Validation Error", filters: ["invalid"] } });
    const error = errorOf(() => parseResponse(site, "datastore_search", 409, body));
    expect(error.kind).toBe("validation");
    expect(error.fields).toEqual({ filters: ["invalid"] });
  });

  it("recognizes an unknown action in a localized plain-text body", () => {
    const error = errorOf(() => parseResponse(site, "x", 400, "คำขอไม่เหมาะสม - Action name not known: x"));
    expect(error.kind).toBe("unsupported");
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [400, "validation"],
    [502, "unavailable"]
  ])("handles an HTML or text error page with HTTP %i", (status, kind) => {
    expect(errorOf(() => parseResponse(site, "x", status, "<!DOCTYPE html><html></html>")).kind).toBe(kind);
  });
});

describe("CkanClient", () => {
  it("retries a 502 once", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("error code: 502", { status: 502 }))
      .mockResolvedValueOnce(new Response('{"success":true,"result":"ok"}'));
    await expect(new CkanClient(fetchImpl).call(site, "a", {}, signal)).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not follow redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"success":true,"result":1}'));
    await new CkanClient(fetchImpl).call(site, "a", {}, signal);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("sends no Authorization header", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"success":true,"result":1}'));
    await new CkanClient(fetchImpl).call(site, "a", {}, signal);
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("caches only through cached()", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"success":true,"result":1}'));
    const client = new CkanClient(fetchImpl);
    await client.cached(site, "status_show", {}, signal);
    await client.cached(site, "status_show", {}, signal);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.call(site, "status_show", {}, signal);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a network failure as unavailable", async () => {
    const failure = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure);
    const error = await new CkanClient(fetchImpl).call(site, "a", {}, signal).catch(e => e as CkanError);
    expect(error).toMatchObject({ kind: "unavailable" });
    expect(error.message).toContain("ENOTFOUND");
  });

  it("does not disguise programming errors as network failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new RangeError("bug"));
    await expect(new CkanClient(fetchImpl).call(site, "a", {}, signal)).rejects.toBeInstanceOf(RangeError);
  });
});
