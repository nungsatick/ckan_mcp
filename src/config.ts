export const SERVER_NAME = "ckan-thaigdc-mcp";
export const SERVER_VERSION = "0.1.0";
export const CHARACTER_LIMIT = 25_000;

export interface Site {
  alias: string;
  baseUrl: string;
}

const DEFAULT_SITES = [
  "nso=https://catalog.nso.go.th",
  "gdcatalog=https://gdcatalog.go.th",
  "datagoth=https://data.go.th",
  "statprovince=https://statprovince.gdcatalog.go.th",
  "kalasin=https://kalasin.gdcatalog.go.th"
].join(",");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Parses "alias=url,alias=url". Only these sites can ever be contacted, which keeps tools from reaching arbitrary hosts. */
export function parseSites(spec: string): Site[] {
  const sites: Site[] = [];
  for (const entry of spec.split(",").map(part => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator < 1) throw new Error(`Invalid CKAN_SITES entry "${entry}". Expected alias=https://host`);
    const alias = entry.slice(0, separator).trim().toLowerCase();
    const url = new URL(entry.slice(separator + 1).trim());
    if (url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(`CKAN_SITES entry "${alias}" must use https (http is allowed only for localhost)`);
    }
    if (sites.some(site => site.alias === alias)) throw new Error(`Duplicate CKAN_SITES alias "${alias}"`);
    sites.push({ alias, baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, "") });
  }
  if (sites.length === 0) throw new Error("CKAN_SITES does not list any sites");
  return sites;
}

export class SiteRegistry {
  constructor(readonly sites: Site[]) {}

  /** Accepts an alias or the exact base URL of a configured site. */
  resolve(input: string): Site {
    const wanted = input.trim().replace(/\/+$/, "").toLowerCase();
    const site = this.sites.find(s => s.alias === wanted || s.baseUrl.toLowerCase() === wanted);
    if (!site) {
      const known = this.sites.map(s => s.alias).join(", ");
      throw new Error(`Unknown site "${input}". Configured sites: ${known}. Add others through the CKAN_SITES environment variable.`);
    }
    return site;
  }
}

export function loadRegistry(env: NodeJS.ProcessEnv = process.env): SiteRegistry {
  return new SiteRegistry(parseSites(env.CKAN_SITES ?? DEFAULT_SITES));
}
