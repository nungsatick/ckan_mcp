#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CkanClient } from "./ckan-client.js";
import { loadRegistry, SERVER_NAME } from "./config.js";
import { createServer } from "./server.js";

const deps = { client: new CkanClient(), registry: loadRegistry() };

serveStdio(() => createServer(deps));
// stderr: stdout carries the protocol
console.error(`${SERVER_NAME} running on stdio with sites: ${deps.registry.sites.map(site => site.alias).join(", ")}`);
