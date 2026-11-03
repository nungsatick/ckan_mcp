import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CkanError } from "../ckan-client.js";
import { CHARACTER_LIMIT, type Site } from "../config.js";
import { isEmpty, READ_ONLY, respond, respondPaged, responseFormat, truncate } from "../format.js";
import { buildSearchParams, referenceFilter, SORT_NAMES } from "../search.js";
import { siteArg, type Deps, type Raw } from "./shared.js";

const FACET_FIELDS = ["organization", "groups", "tags", "res_format", "data_type", "data_category", "license_id"] as const;

// Bookkeeping or restructured fields, left out of the default dataset view
const HIDDEN_DATASET_FIELDS = new Set([
  "creator_user_id", "dataset_tracking", "groups", "id", "isopen", "license_url", "metadata_created", "metadata_modified",
  "name", "notes", "num_resources", "num_tags", "organization", "owner_org", "private", "relationships_as_object",
  "relationships_as_subject", "resources", "revision_id", "state", "tags", "title", "tracking_summary", "type", "version"
]);

interface Facet {
  items: { name: string; display_name: string; count: number }[];
}

function namesOf(value: unknown, key: "name" | "title" | "display_name" = "name"): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String((item as Raw)[key] ?? (item as Raw).name ?? "")).filter(Boolean);
}

function datasetUrl(site: Site, name: unknown): string {
  return `${site.baseUrl}/dataset/${String(name)}`;
}

function publicResources(dataset: Raw): Raw[] {
  const resources = Array.isArray(dataset.resources) ? (dataset.resources as Raw[]) : [];
  return resources.filter(resource => resource.resource_private !== "True");
}

function datasetSummary(site: Site, dataset: Raw) {
  const organization = dataset.organization as Raw | null | undefined;
  const resources = publicResources(dataset);
  return {
    id: dataset.id,
    name: dataset.name,
    title: dataset.title,
    url: datasetUrl(site, dataset.name),
    organization: organization ? { name: organization.name, title: organization.title } : null,
    data_type: dataset.data_type ?? null,
    description: truncate(dataset.notes, 200),
    tags: namesOf(dataset.tags).slice(0, 10),
    formats: [...new Set(resources.map(resource => String(resource.format ?? "").toUpperCase()).filter(Boolean))],
    resource_count: resources.length,
    queryable_resource_count: resources.filter(resource => resource.datastore_active === true).length,
    metadata_modified: dataset.metadata_modified
  };
}

type DatasetSummary = ReturnType<typeof datasetSummary>;

export function resourceSummary(resource: Raw) {
  return {
    id: resource.id,
    name: resource.name,
    format: resource.format,
    url: resource.url,
    queryable: resource.datastore_active === true,
    last_modified: resource.last_modified ?? resource.metadata_modified ?? null,
    description: truncate(resource.description, 200)
  };
}

function renderSummary(dataset: DatasetSummary): string {
  const lines = [`## ${String(dataset.title)}`, `- id: ${String(dataset.id)} | name: ${String(dataset.name)}`];
  if (dataset.organization) lines.push(`- Organization: ${String(dataset.organization.title)} (${String(dataset.organization.name)})`);
  if (dataset.data_type) lines.push(`- Type: ${String(dataset.data_type)}`);
  lines.push(`- Resources: ${dataset.resource_count} (${dataset.formats.join(", ") || "none"}), queryable: ${dataset.queryable_resource_count}`);
  if (dataset.description) lines.push(`- ${dataset.description}`);
  return lines.join("\n");
}

export function registerDatasetTools(server: McpServer, { client, registry }: Deps): void {
  server.registerTool(
    "ckan_search_datasets",
    {
      title: "Search CKAN Datasets",
      description: `Search one catalog's public datasets, with optional filters and counts per category (facets). Returns compact summaries; use ckan_get_dataset for full metadata and the file list.

Examples:
  - "ชุดข้อมูลเกี่ยวกับประชากร" -> query="ประชากร"
  - Words that must be in the title -> title="ประชากร อายุ"
  - "สถิติที่มีไฟล์ CSV" -> query="สถิติ", format="CSV", data_type="stat"
  - "มีหน่วยงานไหนบ้างและชุดข้อมูลละกี่ชุด" -> limit=0, facets=["organization"]

Use names returned by facets, ckan_list_organizations or ckan_list_groups for the organization and group filters.`,
      inputSchema: z.strictObject({
        site: siteArg,
        query: z.string().max(500).optional().describe("Free text, Thai or English. Do not write field:value here for Thai text; use title or the filters"),
        title: z.string().max(200).optional().describe("Space-separated words that must all appear in the title"),
        organization: z.string().optional().describe("Organization name (slug), not its display title"),
        group: z.string().optional().describe("Group name (slug), not its display title"),
        tag: z.string().optional().describe("Exact tag, e.g. 'ประชากร'"),
        format: z.string().optional().describe("Resource format, e.g. 'CSV'"),
        data_type: z.string().optional().describe("One of stat, record, gis, multi, other, or the Thai value such as 'ข้อมูลสถิติ'"),
        fq: z.string().max(500).optional().describe("Advanced: extra raw Solr filter, combined with AND"),
        sort: z.enum(SORT_NAMES).default("relevance").describe("relevance, modified or created (newest first), or title"),
        facets: z.array(z.enum(FACET_FIELDS)).max(7).optional().describe("Fields to count matches by"),
        limit: z.number().int().min(0).max(50).default(10).describe("Datasets to return. 0 returns only counts and facets"),
        offset: z.number().int().min(0).default(0).describe("Matches to skip, for pagination"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async (input, ctx) => {
      const target = registry.resolve(input.site);
      const result = await client.call<{ count: number; results: Raw[]; search_facets?: Record<string, Facet> }>(
        target, "package_search", buildSearchParams(input), ctx.mcpReq.signal
      );

      const facets = Object.fromEntries(
        Object.entries(result.search_facets ?? {}).map(([field, facet]) => [
          field,
          [...facet.items].sort((a, b) => b.count - a.count).map(item => ({ name: item.name, title: item.display_name, count: item.count }))
        ])
      );
      const hint = result.count === 0 && input.query?.includes(":")
        ? "No matches. Field searches such as title:คำ find nothing on Thai text; use the title argument instead."
        : undefined;

      return respondPaged({
        items: result.results.map(dataset => datasetSummary(target, dataset)),
        key: "datasets",
        offset: input.offset,
        total: result.count,
        format: input.response_format,
        extra: { ...(input.facets?.length ? { facets } : {}), ...(hint ? { hint } : {}) },
        markdown: (datasets, page) => {
          const parts = [`# ${page.total ?? 0} datasets on ${target.alias}. Showing ${datasets.length}`];
          if (hint) parts.push(hint);
          for (const [field, items] of Object.entries(facets)) {
            parts.push(`### ${field}\n${items.map(item => `- ${item.title} (${item.name}): ${item.count}`).join("\n")}`);
          }
          parts.push(...datasets.map(renderSummary));
          return parts.join("\n\n");
        }
      });
    }
  );

  server.registerTool(
    "ckan_get_dataset",
    {
      title: "Get CKAN Dataset",
      description: `Get one dataset's metadata and its files (resources). Each resource says whether it is queryable: if so, pass its id to ckan_query_data; if not, give the user its url.

Use ckan_search_datasets to find ids. detail="full" returns the catalog's raw record, which is much longer.`,
      inputSchema: z.strictObject({
        site: siteArg,
        id: z.string().min(1).describe("Dataset name or UUID"),
        detail: z.enum(["standard", "full"]).default("standard").describe("standard omits bookkeeping fields; full is the raw record"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, id, detail, response_format }, ctx) => {
      const target = registry.resolve(site);
      const dataset = await client.call<Raw>(target, "package_show", { id }, ctx.mcpReq.signal);

      if (detail === "full") {
        const text = JSON.stringify(dataset, null, 2);
        if (text.length <= CHARACTER_LIMIT) return { content: [{ type: "text" as const, text }], structuredContent: dataset };
      }

      const organization = dataset.organization as Raw | null | undefined;
      const metadata = Object.fromEntries(
        Object.entries(dataset).filter(([key, value]) => !HIDDEN_DATASET_FIELDS.has(key) && !isEmpty(value))
      );
      const notice = detail === "full" ? `The raw record exceeds ${CHARACTER_LIMIT} characters, so this is the standard view.` : undefined;
      const data = {
        id: dataset.id,
        name: dataset.name,
        title: dataset.title,
        url: datasetUrl(target, dataset.name),
        description: dataset.notes,
        organization: organization ? { name: organization.name, title: organization.title } : null,
        groups: namesOf(dataset.groups, "title"),
        tags: namesOf(dataset.tags),
        metadata_created: dataset.metadata_created,
        metadata_modified: dataset.metadata_modified,
        metadata,
        resources: publicResources(dataset).map(resourceSummary),
        ...(notice ? { notice } : {})
      };

      const markdown = [
        `# ${String(dataset.title)}`,
        ...(notice ? [notice] : []),
        `- id: ${String(dataset.id)} | name: ${String(dataset.name)}`,
        `- URL: ${data.url}`,
        `- Organization: ${organization ? `${String(organization.title)} (${String(organization.name)})` : "none"}`,
        `- Tags: ${data.tags.join(", ") || "none"}`,
        `- Modified: ${String(dataset.metadata_modified)}`,
        "",
        String(dataset.notes ?? ""),
        "",
        "## Metadata",
        ...Object.entries(metadata).map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
        "",
        `## Resources (${data.resources.length})`,
        ...data.resources.map(resource =>
          `- **${String(resource.name)}** [${String(resource.format ?? "")}] id: ${String(resource.id)}, ${resource.queryable ? "queryable" : "file only"}\n  ${String(resource.url)}`
        )
      ].join("\n");
      return respond(response_format, data, markdown);
    }
  );

  server.registerTool(
    "ckan_find_federated_copies",
    {
      title: "Find Federated Dataset Copies",
      description: `Find datasets on other catalogs that were copied from a source catalog, using their reference_url_catalog field. Searches several sites and reports a per-site result, including sites that fail.

Examples:
  - "ชุดข้อมูลนี้ถูกส่งไปจังหวัดไหนบ้าง" -> source_url="https://catalog.nso.go.th/dataset/ns_16_20305"
  - "จังหวัดกาฬสินธุ์รับอะไรจาก NSO บ้าง" -> source_url="https://catalog.nso.go.th", match="prefix", sites=["kalasin"]`,
      inputSchema: z.strictObject({
        source_url: z.url().describe("Source dataset URL, or a URL prefix when match='prefix'"),
        match: z.enum(["exact", "prefix"]).default("exact").describe("exact URL, or every URL starting with source_url"),
        sites: z.array(z.string()).max(20).optional().describe("Site aliases to search. Default: every configured site except the source"),
        limit: z.number().int().min(1).max(50).default(10).describe("Datasets to return per site"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ source_url, match, sites, limit, response_format }, ctx) => {
      const sourceOrigin = new URL(source_url).origin;
      const targets = sites
        ? sites.map(alias => registry.resolve(alias))
        : registry.sites.filter(site => new URL(site.baseUrl).origin !== sourceOrigin);

      const settled = await Promise.allSettled(
        targets.map(target =>
          client.call<{ count: number; results: Raw[] }>(
            target, "package_search",
            { fq: referenceFilter(source_url, match), rows: limit, facet: "false" },
            ctx.mcpReq.signal
          )
        )
      );

      const results = settled.map((outcome, index) => {
        const target = targets[index];
        if (outcome.status === "rejected") {
          const message = outcome.reason instanceof CkanError ? outcome.reason.message : `${target.alias} could not be searched.`;
          return { site: target.alias, total: 0, datasets: [], error: message };
        }
        return {
          site: target.alias,
          total: outcome.value.count,
          datasets: outcome.value.results.map(dataset => ({
            name: dataset.name,
            title: dataset.title,
            url: datasetUrl(target, dataset.name),
            reference_url_catalog: dataset.reference_url_catalog
          }))
        };
      });

      const total = results.reduce((sum, result) => sum + result.total, 0);
      const data = {
        source_url, match, total, results,
        ...(total === 0 && match === "exact" ? { hint: "No exact matches. The copies may cite the source by UUID instead of name; try match='prefix' with the source site's URL." } : {})
      };
      const markdown = [
        `# ${total} copies of ${source_url}`,
        ...(data.hint ? [data.hint] : []),
        ...results.map(result => {
          if (result.error) return `## ${result.site}\nFailed: ${result.error}`;
          const lines = result.datasets.map(dataset => `- ${String(dataset.title)} (${String(dataset.name)})\n  from ${String(dataset.reference_url_catalog)}`);
          return `## ${result.site}: ${result.total}${result.total > lines.length ? `, showing ${lines.length}` : ""}\n${lines.join("\n")}`;
        })
      ].join("\n\n");
      return respond(response_format, data, markdown);
    }
  );
}
