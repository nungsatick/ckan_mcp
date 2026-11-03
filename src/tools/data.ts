import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CkanError } from "../ckan-client.js";
import { markdownTable, READ_ONLY, respond, respondPaged, responseFormat } from "../format.js";
import { resourceSummary } from "./datasets.js";
import { siteArg, type Deps, type Raw } from "./shared.js";

interface DatastoreField {
  id: string;
  type: string;
  info?: { label?: string; notes?: string };
}

interface DatastoreResult {
  fields: DatastoreField[];
  records: Raw[];
  total?: number;
  total_was_estimated?: boolean;
}

const filterValue = z.union([z.string(), z.number(), z.boolean()]);

export function registerDataTools(server: McpServer, { client, registry }: Deps): void {
  server.registerTool(
    "ckan_get_resource",
    {
      title: "Get CKAN Resource",
      description: `Get one file's details. For a queryable resource this also returns its columns, their types and the row count, which ckan_query_data needs for filters and sorting.

Values are often stored as text, including years such as "2565Q2", so check column types before comparing them.`,
      inputSchema: z.strictObject({
        site: siteArg,
        resource_id: z.string().min(1).describe("Resource UUID, from ckan_get_dataset"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, resource_id, response_format }, ctx) => {
      const target = registry.resolve(site);
      const signal = ctx.mcpReq.signal;
      const resource = await client.call<Raw>(target, "resource_show", { id: resource_id }, signal);
      const summary = resourceSummary(resource);

      let table: { row_count: number | undefined; fields: { name: string; type: string; label?: string }[]; download_csv_url: string } | undefined;
      if (summary.queryable) {
        // limit=0 gives columns and the row count on every CKAN version, unlike datastore_info
        const info = await client.call<DatastoreResult>(target, "datastore_search", { resource_id, limit: 0 }, signal);
        table = {
          row_count: info.total,
          fields: info.fields
            .filter(field => field.id !== "_id")
            .map(field => ({ name: field.id, type: field.type, ...(field.info?.label ? { label: field.info.label } : {}) })),
          download_csv_url: `${target.baseUrl}/datastore/dump/${encodeURIComponent(resource_id)}?bom=true`
        };
      }

      const data = { ...summary, dataset_id: resource.package_id, ...(table ? { table } : {}) };
      const markdown = [
        `# ${String(summary.name)}`,
        `- id: ${String(summary.id)} | dataset: ${String(resource.package_id)}`,
        `- Format: ${String(summary.format ?? "")}`,
        `- URL: ${String(summary.url)}`,
        `- Modified: ${String(summary.last_modified)}`,
        ...(summary.description ? [`- ${summary.description}`] : []),
        ...(table
          ? [
              "",
              `## Queryable table: ${String(table.row_count)} rows`,
              `CSV: ${table.download_csv_url}`,
              "",
              markdownTable(table.fields)
            ]
          : ["", "Not queryable with ckan_query_data. Use the URL above to get the file."])
      ].join("\n");
      return respond(response_format, data, markdown);
    }
  );

  server.registerTool(
    "ckan_query_data",
    {
      title: "Query CKAN Table",
      description: `Read rows from a queryable resource, with filters, full-text search, column selection, sorting and distinct values. Only works where ckan_get_dataset shows the resource as queryable.

Call ckan_get_resource first for the column names: an unknown column is an error.

Examples:
  - Rows for one region -> filters={"region": "ภาคเหนือ"}
  - Several values -> filters={"region": ["ภาคเหนือ", "ภาคใต้"]}
  - Which regions exist -> fields=["region"], distinct=true
  - Highest values first -> sort="Per_HH_Tablet desc", limit=5`,
      inputSchema: z.strictObject({
        site: siteArg,
        resource_id: z.string().min(1).describe("Resource UUID"),
        filters: z.record(z.string(), z.union([filterValue, z.array(filterValue)])).optional().describe("Exact matches by column; a list matches any of its values"),
        q: z.string().max(500).optional().describe("Full-text search across all columns"),
        fields: z.array(z.string()).optional().describe("Columns to return. Default: all"),
        sort: z.string().max(200).optional().describe("e.g. 'year desc, region'"),
        distinct: z.boolean().default(false).describe("Return only distinct rows; combine with fields"),
        limit: z.number().int().min(1).max(1000).default(100).describe("Rows to return. Fewer may come back if the response would be too long"),
        offset: z.number().int().min(0).default(0).describe("Rows to skip, for pagination"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, resource_id, filters, q, fields, sort, distinct, limit, offset, response_format }, ctx) => {
      const target = registry.resolve(site);
      let result: DatastoreResult;
      try {
        result = await client.call<DatastoreResult>(
          target, "datastore_search",
          { resource_id, filters, q, fields: fields?.join(","), sort, distinct: distinct || undefined, limit, offset },
          ctx.mcpReq.signal
        );
      } catch (error) {
        if (error instanceof CkanError && error.kind === "not_found") {
          throw new CkanError("not_found", `${target.alias} has no queryable table for resource ${resource_id}. Use ckan_get_resource to get its file URL instead.`, error.status);
        }
        if (error instanceof CkanError && error.kind === "validation") {
          throw new CkanError("validation", `${error.message}. Use ckan_get_resource to list the valid column names.`, error.status, error.fields);
        }
        throw error;
      }

      return respondPaged({
        items: result.records,
        key: "records",
        offset,
        total: result.total,
        moreAvailable: result.records.length === limit,
        format: response_format,
        extra: {
          fields: result.fields.map(field => ({ name: field.id, type: field.type })),
          ...(result.total_was_estimated ? { total_was_estimated: true } : {})
        },
        markdown: (records, page) => {
          const estimated = result.total_was_estimated ? " (estimated)" : "";
          const heading = `# ${String(page.total ?? "Unknown number of")}${estimated} rows. Showing ${records.length} from offset ${offset}`;
          return records.length > 0 ? `${heading}\n\n${markdownTable(records)}` : `${heading}\n\nNo rows match.`;
        }
      });
    }
  );
}
