/**
 * Self-check: starts the built server over stdio and calls every tool against live sites.
 * Run with: npm run build && npm run smoke
 * SMOKE_SITE picks the site that has searchable data (default nso); CKAN_SITES is passed through.
 */
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const site = process.env.SMOKE_SITE ?? "nso";

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...getDefaultEnvironment(), ...(process.env.CKAN_SITES ? { CKAN_SITES: process.env.CKAN_SITES } : {}) }
  })
);

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: { ...args, response_format: "json" } });
  assert.ok(!result.isError, `${name} failed: ${JSON.stringify(result.content)}`);
  console.error(`ok  ${name}`);
  return result.structuredContent as T;
}

const { tools } = await client.listTools();
assert.deepEqual(tools.map(tool => tool.name).sort(), [
  "ckan_find_federated_copies",
  "ckan_get_dataset",
  "ckan_get_resource",
  "ckan_get_schema",
  "ckan_list_groups",
  "ckan_list_organizations",
  "ckan_list_sites",
  "ckan_query_data",
  "ckan_search_datasets",
  "ckan_search_tags",
  "ckan_site_info"
]);

await call("ckan_list_sites", {});
const info = await call<{ capabilities: { scheming: boolean } }>("ckan_site_info", { site });
await call("ckan_list_organizations", { site, limit: 3 });
await call("ckan_list_groups", { site, limit: 3 });

const search = await call<{ total: number; datasets: { id: string; queryable_resource_count: number }[] }>(
  "ckan_search_datasets",
  { site, limit: 50, facets: ["organization"] }
);
console.error(`    ${search.total} datasets`);

if (search.datasets.length > 0) {
  await call("ckan_get_dataset", { site, id: search.datasets[0].id });
  const withTable = search.datasets.find(dataset => dataset.queryable_resource_count > 0);
  if (withTable) {
    const dataset = await call<{ resources: { id: string; queryable: boolean }[] }>("ckan_get_dataset", { site, id: withTable.id });
    const resource = dataset.resources.find(item => item.queryable)!;
    const details = await call<{ table: { fields: { name: string }[] } }>("ckan_get_resource", { site, resource_id: resource.id });
    const rows = await call<{ records: unknown[] }>("ckan_query_data", { site, resource_id: resource.id, limit: 2, fields: [details.table.fields[0].name] });
    assert.ok(rows.records.length > 0, "query should return rows");

    const badColumn = await client.callTool({ name: "ckan_query_data", arguments: { site, resource_id: resource.id, filters: { no_such_column: "x" } } });
    assert.equal(badColumn.isError, true, "an unknown column should be a tool error");
  } else {
    console.error("    no queryable resource in the first page; skipped table tools");
  }
}

await call("ckan_search_tags", { site, query: "a" });
if (info.capabilities.scheming) await call("ckan_get_schema", { site, field: "data_type" });
await call("ckan_find_federated_copies", { source_url: "https://catalog.nso.go.th", match: "prefix", sites: [site], limit: 1 });

const unknownSite = await client.callTool({ name: "ckan_site_info", arguments: { site: "https://example.com" } });
assert.equal(unknownSite.isError, true, "a site outside the allowlist should be refused");

const invalid = await client.callTool({ name: "ckan_search_datasets", arguments: { site, limit: 1000 } });
assert.equal(invalid.isError, true, "limit above 50 should be rejected");

await client.close();
console.error("Smoke test passed");
