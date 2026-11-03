import { describe, expect, it } from "vitest";
import { parseSites, SiteRegistry } from "../src/config.js";
import { respondPaged } from "../src/format.js";
import { buildSearchParams, referenceFilter, titleFilter } from "../src/search.js";

const base = { sort: "relevance" as const, limit: 10, offset: 0 };

describe("buildSearchParams", () => {
  it("maps data_type aliases to the Thai stored value", () => {
    expect(buildSearchParams({ ...base, data_type: "stat" }).fq).toBe('data_type:"ข้อมูลสถิติ"');
  });

  it("passes Thai data_type values through", () => {
    expect(buildSearchParams({ ...base, data_type: "ข้อมูลระเบียน" }).fq).toBe('data_type:"ข้อมูลระเบียน"');
  });

  it("combines filters with AND and uppercases the format", () => {
    expect(buildSearchParams({ ...base, organization: "nso", format: "csv", fq: "private:false" }).fq)
      .toBe('organization:"nso" AND res_format:"CSV" AND private:false');
  });

  it("escapes quotes in filter values", () => {
    expect(buildSearchParams({ ...base, tag: 'a"b' }).fq).toBe('tags:"a\\"b"');
  });

  it("turns facets off unless asked for", () => {
    expect(buildSearchParams(base).facet).toBe("false");
    const params = buildSearchParams({ ...base, facets: ["organization"] });
    expect(params.facet).toBeUndefined();
    expect(params["facet.field"]).toEqual(["organization"]);
  });
});

describe("titleFilter", () => {
  it("wraps each word in wildcards because bare Thai terms match nothing", () => {
    expect(titleFilter("ประชากร อายุ")).toBe("title:*ประชากร* AND title:*อายุ*");
  });

  it("escapes Solr syntax", () => {
    expect(titleFilter("a:b")).toBe("title:*a\\:b*");
  });
});

describe("referenceFilter", () => {
  it("quotes an exact URL", () => {
    expect(referenceFilter("https://a.go.th/dataset/x", "exact")).toBe('reference_url_catalog:"https://a.go.th/dataset/x"');
  });

  it("escapes a prefix URL", () => {
    expect(referenceFilter("https://a.go.th", "prefix")).toBe("reference_url_catalog:https\\:\\/\\/a.go.th*");
  });
});

describe("parseSites", () => {
  it("parses aliases and strips trailing slashes", () => {
    expect(parseSites("NSO=https://catalog.nso.go.th/, local=http://localhost:8881")).toEqual([
      { alias: "nso", baseUrl: "https://catalog.nso.go.th" },
      { alias: "local", baseUrl: "http://localhost:8881" }
    ]);
  });

  it("rejects plain http for remote hosts", () => {
    expect(() => parseSites("a=http://catalog.nso.go.th")).toThrow(/https/);
  });

  it("rejects malformed entries, duplicates and empty lists", () => {
    expect(() => parseSites("https://x.go.th")).toThrow();
    expect(() => parseSites("a=https://x.go.th,a=https://y.go.th")).toThrow(/Duplicate/);
    expect(() => parseSites(" ")).toThrow(/any sites/);
  });
});

describe("SiteRegistry", () => {
  const registry = new SiteRegistry(parseSites("nso=https://catalog.nso.go.th"));

  it("resolves an alias or the exact base URL", () => {
    expect(registry.resolve("NSO").alias).toBe("nso");
    expect(registry.resolve("https://catalog.nso.go.th/").alias).toBe("nso");
  });

  it("refuses anything else and names the configured sites", () => {
    expect(() => registry.resolve("https://evil.example")).toThrow(/Configured sites: nso/);
  });
});

describe("respondPaged", () => {
  it("returns fewer items when over the character limit, with next_offset at the first left out", () => {
    const items = Array.from({ length: 8 }, (_, id) => ({ id, text: "x".repeat(10_000) }));
    const result = respondPaged({ items, key: "items", offset: 4, total: 100, format: "json", markdown: () => "" });
    const data = result.structuredContent as { count: number; next_offset: number };
    expect(data.count).toBe(2);
    expect(data.next_offset).toBe(6);
    expect(result.content[0].text.length).toBeLessThan(25_000);
  });

  it("has no next_offset on the last page and adds no footer", () => {
    const result = respondPaged({ items: [1], key: "items", offset: 0, total: 1, format: "markdown", markdown: () => "done" });
    expect(result.content[0].text).toBe("done");
  });

  it("offers no next page when only counts were asked for", () => {
    const result = respondPaged({ items: [], key: "items", offset: 0, total: 5, format: "markdown", markdown: () => "x" });
    expect(result.content[0].text).toBe("x");
  });

  it("uses moreAvailable when there is no total", () => {
    const result = respondPaged({ items: [1], key: "items", offset: 0, moreAvailable: true, format: "markdown", markdown: () => "x" });
    expect(result.content[0].text).toContain("offset=1");
  });
});
