import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CkanError } from "../ckan-client.js";
import { READ_ONLY, respondPaged, responseFormat, truncate } from "../format.js";
import { siteArg, type Deps, type Raw } from "./shared.js";

// Stock CKAN silently caps all_fields listings at this many rows, whatever limit was asked for
const ALL_FIELDS_DEFAULT_CAP = 25;

function registerListTool(
  server: McpServer,
  { client, registry }: Deps,
  options: { tool: string; title: string; noun: string; action: string; autocomplete: string; filterArg: string }
): void {
  const { tool, title, noun, action, autocomplete, filterArg } = options;
  server.registerTool(
    tool,
    {
      title,
      description: `List a catalog's ${noun}s with dataset counts, or find them by name. Pass the returned name as the ${filterArg} filter of ckan_search_datasets.

Example: "หน่วยงานที่ชื่อมีคำว่าสถิติ" -> query="สถิติ" (returns matches without dataset counts).`,
      inputSchema: z.strictObject({
        site: siteArg,
        query: z.string().min(1).max(200).optional().describe(`Text to match against ${noun} names and titles`),
        limit: z.number().int().min(1).max(100).default(25).describe(`Maximum ${noun}s to return`),
        offset: z.number().int().min(0).default(0).describe("Items to skip, for pagination. Ignored with query"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, query, limit, offset, response_format }, ctx) => {
      const target = registry.resolve(site);
      const signal = ctx.mcpReq.signal;

      const raw = query
        ? await client.call<Raw[]>(target, autocomplete, { q: query, limit }, signal)
        : await client.call<Raw[]>(target, action, { all_fields: true, limit, offset }, signal);

      const items = raw.map(item => ({
        name: item.name,
        title: item.title ?? item.display_name ?? item.name,
        ...(item.package_count !== undefined ? { dataset_count: item.package_count } : {}),
        ...(truncate(item.description, 200) ? { description: truncate(item.description, 200) } : {})
      }));

      return respondPaged({
        items,
        key: `${noun}s`,
        offset: query ? 0 : offset,
        moreAvailable: !query && raw.length >= Math.min(limit, ALL_FIELDS_DEFAULT_CAP),
        format: response_format,
        markdown: shown => {
          if (shown.length === 0) return `No ${noun}s found on ${target.alias}.`;
          const lines = shown.map(item => {
            const count = item.dataset_count !== undefined ? `: ${String(item.dataset_count)} datasets` : "";
            return `- ${String(item.title)} (${String(item.name)})${count}`;
          });
          return `# ${noun}s on ${target.alias}\n\n${lines.join("\n")}`;
        }
      });
    }
  );
}

export function registerTaxonomyTools(server: McpServer, deps: Deps): void {
  const { client, registry } = deps;

  registerListTool(server, deps, {
    tool: "ckan_list_organizations",
    title: "List CKAN Organizations",
    noun: "organization",
    action: "organization_list",
    autocomplete: "organization_autocomplete",
    filterArg: "organization"
  });

  registerListTool(server, deps, {
    tool: "ckan_list_groups",
    title: "List CKAN Groups",
    noun: "group",
    action: "group_list",
    autocomplete: "group_autocomplete",
    filterArg: "group"
  });

  server.registerTool(
    "ckan_search_tags",
    {
      title: "Search CKAN Tags",
      description: `Find tags containing some text, plus search terms the catalog suggests where available. Pass a returned tag as the tag filter of ckan_search_datasets.

Example: query="ประชากร".`,
      inputSchema: z.strictObject({
        site: siteArg,
        query: z.string().min(1).max(100).describe("Text the tag should contain"),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum tags to return"),
        offset: z.number().int().min(0).default(0).describe("Tags to skip, for pagination"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, query, limit, offset, response_format }, ctx) => {
      const target = registry.resolve(site);
      const signal = ctx.mcpReq.signal;

      const [tags, suggestions] = await Promise.all([
        client.call<string[]>(target, "tag_list", { query }, signal),
        client
          .call<{ value: string }[]>(target, "discovery_search_suggest", { q: query }, signal)
          .then(items => items.map(item => item.value))
          .catch((error: unknown) => {
            // Suggestions come from an extension many sites lack; tags alone still answer the question
            if (error instanceof CkanError) return [] as string[];
            throw error;
          })
      ]);

      return respondPaged({
        items: tags.slice(offset, offset + limit),
        key: "tags",
        offset,
        total: tags.length,
        format: response_format,
        extra: { suggestions },
        markdown: shown => {
          const parts = [`# ${tags.length} tags matching "${query}" on ${target.alias}`];
          if (shown.length > 0) parts.push(shown.map(tag => `- ${tag}`).join("\n"));
          if (suggestions.length > 0) parts.push(`Suggested searches: ${suggestions.join(", ")}`);
          return parts.join("\n\n");
        }
      });
    }
  );
}
