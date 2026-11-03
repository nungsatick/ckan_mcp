import { SERVER_NAME, SERVER_VERSION, type Site } from "./config.js";

const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const CACHE_TTL_MS = 10 * 60_000;

export type CkanErrorKind =
  | "not_found"
  | "forbidden"
  | "validation"
  | "unsupported"
  | "unavailable"
  | "invalid_response";

export class CkanError extends Error {
  constructor(
    readonly kind: CkanErrorKind,
    message: string,
    readonly status?: number,
    readonly fields?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CkanError";
  }
}

type ParamValue = string | number | boolean | undefined | unknown[] | Record<string, unknown>;
export type Params = Record<string, ParamValue>;

interface Envelope {
  success?: boolean;
  result?: unknown;
  error?: Record<string, unknown> & { __type?: string; message?: unknown };
}

/** GET parameters: lists and objects are JSON strings, which CKAN decodes per parameter. */
export function buildActionUrl(site: Site, action: string, params: Params): URL {
  const url = new URL(`${site.baseUrl}/api/3/action/${action}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return url;
}

// CKAN's documented "always 200" is not what sites do, and bodies can be JSON, plain text or an HTML page.
export function parseResponse(site: Site, action: string, status: number, body: string): unknown {
  let envelope: Envelope | undefined;
  try {
    envelope = JSON.parse(body) as Envelope;
  } catch {
    envelope = undefined;
  }

  if (envelope && typeof envelope === "object" && "success" in envelope) {
    if (envelope.success) return envelope.result;
    throw errorFromEnvelope(site, action, status, envelope);
  }

  if (/action name not known/i.test(body)) {
    throw new CkanError("unsupported", `${site.alias} does not provide the "${action}" action. Use ckan_site_info to see which features it has.`, status);
  }
  if (status === 403) throw new CkanError("forbidden", `Access denied by ${site.alias} for "${action}". This server is read-only and sends no token, so only public data is available.`, status);
  if (status === 404) throw new CkanError("not_found", `${site.alias} found nothing for "${action}". Check the id; ckan_search_datasets returns valid ids.`, status);
  if (status === 400) throw new CkanError("validation", `${site.alias} rejected the "${action}" request (HTTP 400). Check the arguments.`, status);
  if (status >= 500) throw unavailable(site, status);
  throw new CkanError("invalid_response", `${site.alias} returned an unexpected response for "${action}" (HTTP ${status}).`, status);
}

// __type is stable; message text is localized (often Thai), so it is only shown, never matched.
function errorFromEnvelope(site: Site, action: string, status: number, envelope: Envelope): CkanError {
  const { __type: type, message, ...fields } = envelope.error ?? {};
  const detail = typeof message === "string" ? `: ${message}` : "";
  switch (type) {
    case "Not Found Error":
      return new CkanError("not_found", `Not found on ${site.alias} (${action})${detail}. Check the id; ckan_search_datasets returns valid ids.`, status);
    case "Authorization Error":
      return new CkanError("forbidden", `Access denied by ${site.alias} for "${action}"${detail}. This server is read-only and sends no token, so only public data is available.`, status);
    case "Validation Error":
      return new CkanError("validation", `${site.alias} rejected the arguments for "${action}": ${JSON.stringify(fields)}`, status, fields);
    default:
      return new CkanError("invalid_response", `${site.alias} reported an error for "${action}" (${type ?? "unknown"})${detail}.`, status);
  }
}

function unavailable(site: Site, status?: number): CkanError {
  const code = status ? ` (HTTP ${status})` : "";
  return new CkanError("unavailable", `${site.alias} is not responding${code}. Try again shortly, or ask for fewer rows.`, status);
}

export class CkanClient {
  private readonly cache = new Map<string, { expires: number; value: unknown }>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async call<T>(site: Site, action: string, params: Params, signal: AbortSignal): Promise<T> {
    const url = buildActionUrl(site, action, params);
    let response = await this.request(site, url, signal);
    if (RETRYABLE_STATUS.has(response.status)) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      response = await this.request(site, url, signal);
    }
    return parseResponse(site, action, response.status, await response.text()) as T;
  }

  /** For status and schema responses, which are large or asked for often and rarely change. */
  async cached<T>(site: Site, action: string, params: Params, signal: AbortSignal): Promise<T> {
    const key = buildActionUrl(site, action, params).href;
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await this.call<T>(site, action, params, signal);
    this.cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  private async request(site: Site, url: URL, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": `${SERVER_NAME}/${SERVER_VERSION}` },
        // A redirect could leave the configured site, so it is reported instead of followed
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new CkanError("unavailable", `${site.alias} did not respond within ${TIMEOUT_MS / 1000} seconds. Try again, or ask for fewer rows.`);
      }
      if (error instanceof TypeError && error.message === "fetch failed") {
        const cause = (error.cause as { code?: string; message?: string } | undefined);
        throw new CkanError("unavailable", `${site.alias} could not be reached (${cause?.code ?? cause?.message ?? "network error"}). Check the connection and try again.`);
      }
      throw error;
    }
  }
}
