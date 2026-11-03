import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { READ_ONLY, respond, responseFormat } from "../format.js";
import { siteArg, type Deps, type Raw } from "./shared.js";

const CAPABILITY_EXTENSIONS: Record<string, string> = {
  datastore: "datastore",
  scheming: "scheming_datasets",
  thai_gdc: "thai_gdc",
  harvest: "harvest",
  dcat: "dcat",
  activity: "activity"
};

export function registerSiteTools(server: McpServer, { client, registry }: Deps): void {
  server.registerTool(
    "ckan_list_sites",
    {
      title: "List CKAN Sites",
      description: "List the CKAN catalogs this server may query, with the aliases other tools take as `site`. Call this first when you do not know which catalog to use.",
      inputSchema: z.strictObject({ response_format: responseFormat }),
      annotations: { ...READ_ONLY, openWorldHint: false }
    },
    async ({ response_format }) => {
      const lines = registry.sites.map(site => `- **${site.alias}**: ${site.baseUrl}`);
      return respond(response_format, { sites: registry.sites }, `# Configured CKAN sites\n\n${lines.join("\n")}`);
    }
  );

  server.registerTool(
    "ckan_site_info",
    {
      title: "Get CKAN Site Info",
      description: `Get a catalog's CKAN and Thai GDC versions, catalog type, dataset count and features.

Use this to check whether a site supports something before relying on it: capabilities.datastore means tabular data may be queryable with ckan_query_data, capabilities.scheming means ckan_get_schema works.`,
      inputSchema: z.strictObject({ site: siteArg, response_format: responseFormat }),
      annotations: READ_ONLY
    },
    async ({ site, response_format }, ctx) => {
      const target = registry.resolve(site);
      const signal = ctx.mcpReq.signal;
      const [status, search] = await Promise.all([
        client.cached<Raw>(target, "status_show", {}, signal),
        client.call<{ count: number }>(target, "package_search", { rows: 0, facet: "false" }, signal)
      ]);

      const rawExtensions = status.extensions;
      const extensions: string[] = Array.isArray(rawExtensions)
        ? rawExtensions.map(String)
        : String(rawExtensions ?? "").split(/\s+/).filter(Boolean);
      const capabilities = Object.fromEntries(
        Object.entries(CAPABILITY_EXTENSIONS).map(([name, extension]) => [name, extensions.includes(extension)])
      );

      const data = {
        site: target.alias,
        url: target.baseUrl,
        title: status.site_title,
        description: status.site_description,
        ckan_version: status.ckan_version,
        thaigdc_version: status.thaigdc_version ?? null,
        catalog_type: status.thaigdc_catalog_type ?? null,
        locale: status.locale_default,
        dataset_count: search.count,
        capabilities,
        extensions
      };

      const enabled = Object.entries(capabilities).filter(([, on]) => on).map(([name]) => name);
      const markdown = [
        `# ${String(status.site_title ?? target.alias)} (${target.alias})`,
        `- URL: ${target.baseUrl}`,
        `- CKAN: ${String(status.ckan_version)}`,
        `- Thai GDC: ${String(status.thaigdc_version ?? "not reported")}`,
        `- Catalog type: ${String(status.thaigdc_catalog_type ?? "not reported")}`,
        `- Public datasets: ${search.count}`,
        `- Features: ${enabled.join(", ") || "none detected"}`
      ].join("\n");
      return respond(response_format, data, markdown);
    }
  );
}
