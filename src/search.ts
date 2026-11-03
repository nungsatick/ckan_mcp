import type { Params } from "./ckan-client.js";

// thai_gdc catalogs store data_type in Thai, so `fq=data_type:stat` silently matches nothing.
const DATA_TYPE_ALIASES: Record<string, string> = {
  stat: "ข้อมูลสถิติ",
  record: "ข้อมูลระเบียน",
  gis: "ข้อมูลภูมิสารสนเทศเชิงพื้นที่",
  multi: "ข้อมูลหลากหลายประเภท",
  other: "ข้อมูลประเภทอื่นๆ"
};

const SORT_ORDERS = {
  relevance: undefined,
  modified: "metadata_modified desc",
  created: "metadata_created desc",
  title: "title_string asc"
} as const;

export type SortOrder = keyof typeof SORT_ORDERS;
export const SORT_NAMES = Object.keys(SORT_ORDERS) as [SortOrder, ...SortOrder[]];

export interface SearchInput {
  query?: string;
  title?: string;
  organization?: string;
  group?: string;
  tag?: string;
  format?: string;
  data_type?: string;
  fq?: string;
  sort: SortOrder;
  facets?: string[];
  limit: number;
  offset: number;
}

export function escapeSolrTerm(term: string): string {
  return term.replace(/[+\-&|!(){}[\]^"~*?:\\/\s]/g, "\\$&");
}

export function solrPhrase(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/** A bare `title:คำ` finds nothing on Thai text because Solr does not tokenize it into words, but `title:*คำ*` does. */
export function titleFilter(title: string): string | undefined {
  const terms = title.split(/\s+/).filter(Boolean).map(term => `title:*${escapeSolrTerm(term)}*`);
  return terms.length > 0 ? terms.join(" AND ") : undefined;
}

export function buildSearchParams(input: SearchInput): Params {
  const filters: string[] = [];
  if (input.organization) filters.push(`organization:${solrPhrase(input.organization)}`);
  if (input.group) filters.push(`groups:${solrPhrase(input.group)}`);
  if (input.tag) filters.push(`tags:${solrPhrase(input.tag)}`);
  if (input.format) filters.push(`res_format:${solrPhrase(input.format.toUpperCase())}`);
  if (input.data_type) {
    filters.push(`data_type:${solrPhrase(DATA_TYPE_ALIASES[input.data_type.toLowerCase()] ?? input.data_type)}`);
  }
  const title = input.title ? titleFilter(input.title) : undefined;
  if (title) filters.push(title);
  if (input.fq) filters.push(input.fq);

  const hasFacets = Boolean(input.facets?.length);
  return {
    q: input.query || undefined,
    fq: filters.length > 0 ? filters.join(" AND ") : undefined,
    sort: SORT_ORDERS[input.sort],
    rows: input.limit,
    start: input.offset,
    facet: hasFacets ? undefined : "false",
    "facet.field": hasFacets ? input.facets : undefined,
    "facet.limit": hasFacets ? 20 : undefined
  };
}

export function referenceFilter(sourceUrl: string, match: "exact" | "prefix"): string {
  return match === "exact"
    ? `reference_url_catalog:${solrPhrase(sourceUrl)}`
    : `reference_url_catalog:${escapeSolrTerm(sourceUrl)}*`;
}
