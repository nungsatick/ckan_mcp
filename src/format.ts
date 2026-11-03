import * as z from "zod/v4";
import { CHARACTER_LIMIT } from "./config.js";

export const responseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("'markdown' for readable text, 'json' for structured data");

export type ResponseFormat = z.infer<typeof responseFormat>;

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;

export interface Page {
  total?: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

export function respond(format: ResponseFormat, data: Record<string, unknown>, markdown: string) {
  if (format === "json") {
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
  }
  return { content: [{ type: "text" as const, text: markdown }] };
}

interface PagedOptions<T> {
  items: T[];
  key: string;
  offset: number;
  total?: number;
  /** For APIs with no total: whether a further page may exist. */
  moreAvailable?: boolean;
  format: ResponseFormat;
  extra?: Record<string, unknown>;
  markdown: (items: T[], page: Page) => string;
}

/** Stays under CHARACTER_LIMIT by returning fewer items, so next_offset points at the first one left out. */
export function respondPaged<T>({ items, key, offset, total, moreAvailable, format, extra, markdown }: PagedOptions<T>) {
  const render = (shown: T[]) => {
    const nextOffset = offset + shown.length;
    const hasMore = total !== undefined ? total > nextOffset : shown.length < items.length || Boolean(moreAvailable);
    const page: Page = {
      ...(total !== undefined ? { total } : {}),
      count: shown.length,
      offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: nextOffset } : {})
    };
    const data = { ...page, ...extra, [key]: shown };
    // With limit=0 only counts were asked for, so there is no next page to offer
    const footer = hasMore && shown.length > 0 ? `\n\nMore results: call again with offset=${nextOffset}.` : "";
    return { data, text: format === "json" ? JSON.stringify(data, null, 2) : markdown(shown, page) + footer };
  };

  let shown = items;
  let result = render(shown);
  while (shown.length > 1 && result.text.length > CHARACTER_LIMIT) {
    shown = shown.slice(0, Math.ceil(shown.length / 2));
    result = render(shown);
  }
  return respond(format, result.data, result.text);
}

export function truncate(text: unknown, length: number): string {
  const value = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

export function markdownTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) =>
    (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value))
      .replace(/\|/g, "\\|")
      .replace(/\s*\n\s*/g, " ");
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${columns.map(column => cell(row[column])).join(" | ")} |`)
  ].join("\n");
}
