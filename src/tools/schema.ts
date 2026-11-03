import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CkanError } from "../ckan-client.js";
import { READ_ONLY, respondPaged, responseFormat } from "../format.js";
import { siteArg, type Deps } from "./shared.js";

interface SchemaField {
  field_name: string;
  label?: string | Record<string, string>;
  required?: boolean;
  validators?: string;
  choices?: { value: string; label?: string | Record<string, string> }[];
}

interface DatasetSchema {
  dataset_fields: SchemaField[];
  resource_fields: SchemaField[];
}

function labelOf(label: SchemaField["label"]): string | undefined {
  if (typeof label === "string") return label;
  return label?.th ?? label?.en;
}

export function isRequired(field: SchemaField): boolean {
  return field.required === true || /\b(scheming_required|not_empty)\b/.test(field.validators ?? "");
}

export function registerSchemaTools(server: McpServer, { client, registry }: Deps): void {
  server.registerTool(
    "ckan_get_schema",
    {
      title: "Get CKAN Metadata Schema",
      description: `Get a catalog's metadata fields: their labels, whether they are required, and allowed values.

Use this to learn what a field means, or the exact value to filter on: values are usually Thai and differ from English-looking names (update_frequency_unit is 'ปี', not 'year').

By default choices are only counted. Pass field="objective" or include_choices=true to see them.`,
      inputSchema: z.strictObject({
        site: siteArg,
        section: z.enum(["dataset", "resource"]).default("dataset").describe("Dataset-level or file-level fields"),
        field: z.string().optional().describe("Return only this field, with its choices"),
        include_choices: z.boolean().default(false).describe("Include every field's allowed values"),
        limit: z.number().int().min(1).max(200).default(100).describe("Maximum fields to return"),
        offset: z.number().int().min(0).default(0).describe("Fields to skip, for pagination"),
        response_format: responseFormat
      }),
      annotations: READ_ONLY
    },
    async ({ site, section, field, include_choices, limit, offset, response_format }, ctx) => {
      const target = registry.resolve(site);
      let schema: DatasetSchema;
      try {
        schema = await client.cached<DatasetSchema>(target, "scheming_dataset_schema_show", { type: "dataset" }, ctx.mcpReq.signal);
      } catch (error) {
        if (error instanceof CkanError && error.kind === "unsupported") {
          throw new CkanError("unsupported", `${target.alias} has no metadata schema (ckanext-scheming is not installed), so it uses stock CKAN fields.`, error.status);
        }
        throw error;
      }

      const all = section === "dataset" ? schema.dataset_fields : schema.resource_fields;
      const selected = field ? all.filter(item => item.field_name === field) : all;
      if (field && selected.length === 0) {
        throw new CkanError("not_found", `${target.alias} has no ${section} field "${field}". Fields: ${all.map(item => item.field_name).join(", ")}`);
      }

      const showChoices = include_choices || Boolean(field);
      const items = selected.slice(offset, offset + limit).map(item => ({
        name: item.field_name,
        label: labelOf(item.label) ?? null,
        required: isRequired(item),
        choice_count: item.choices?.length ?? 0,
        ...(showChoices && item.choices ? { choices: item.choices.map(choice => choice.value) } : {})
      }));

      return respondPaged({
        items,
        key: "fields",
        offset,
        total: selected.length,
        format: response_format,
        extra: { section },
        markdown: shown => {
          const lines = shown.map(item => {
            const tags = [item.required ? "required" : "", item.choice_count ? `${item.choice_count} choices` : ""].filter(Boolean).join(", ");
            const head = `- **${item.name}**${item.label ? `: ${item.label}` : ""}${tags ? ` (${tags})` : ""}`;
            return item.choices ? `${head}\n  ${item.choices.join(" | ")}` : head;
          });
          return `# ${section} fields on ${target.alias}\n\n${lines.join("\n")}`;
        }
      });
    }
  );
}
