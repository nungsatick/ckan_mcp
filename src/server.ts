import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { registerDataTools } from "./tools/data.js";
import { registerDatasetTools } from "./tools/datasets.js";
import { registerSchemaTools } from "./tools/schema.js";
import type { Deps } from "./tools/shared.js";
import { registerSiteTools } from "./tools/sites.js";
import { registerTaxonomyTools } from "./tools/taxonomy.js";

export function createServer(deps: Deps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerSiteTools(server, deps);
  registerDatasetTools(server, deps);
  registerDataTools(server, deps);
  registerTaxonomyTools(server, deps);
  registerSchemaTools(server, deps);
  return server;
}
