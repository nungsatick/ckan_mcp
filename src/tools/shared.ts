import * as z from "zod/v4";
import type { CkanClient } from "../ckan-client.js";
import type { SiteRegistry } from "../config.js";

export interface Deps {
  client: CkanClient;
  registry: SiteRegistry;
}

export const siteArg = z
  .string()
  .min(1)
  .describe("Site alias from ckan_list_sites, e.g. 'nso'");

export type Raw = Record<string, unknown>;
