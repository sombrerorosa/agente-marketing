import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat } from "../schemas/common.js";
import type { PagedResult } from "../types.js";

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Builds the dual text/structured response every tool returns, truncating
 * the rendered text (and, for lists, dropping trailing items from the
 * structured payload to match) if it would blow past CHARACTER_LIMIT.
 */
export function buildResponse(jsonPayload: Record<string, unknown>, markdownText: string, format: ResponseFormat): ToolResponse {
  let text = format === ResponseFormat.JSON ? JSON.stringify(jsonPayload, null, 2) : markdownText;
  let payload = jsonPayload;

  if (text.length > CHARACTER_LIMIT && Array.isArray((jsonPayload as { items?: unknown[] }).items)) {
    const items = (jsonPayload as { items: unknown[] }).items;
    const kept = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
    payload = {
      ...jsonPayload,
      items: kept,
      truncated: true,
      truncation_message: `Response truncated from ${items.length} to ${kept.length} items. Use the 'after' cursor or narrow your filters to see the rest.`,
    };
    text = format === ResponseFormat.JSON ? JSON.stringify(payload, null, 2) : `${markdownText}\n\n_(truncated — response was too large; narrow your filters or page further)_`;
  } else if (text.length > CHARACTER_LIMIT) {
    text = `${text.slice(0, CHARACTER_LIMIT)}\n\n... (truncated)`;
  }

  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
  };
}

export function errorResponse(message: string): ToolResponse {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
  };
}

export function pagedJson<T>(paged: PagedResult<T>): Record<string, unknown> {
  return {
    count: paged.count,
    items: paged.items as unknown[],
    has_more: paged.has_more,
    ...(paged.next_cursor ? { next_cursor: paged.next_cursor } : {}),
  };
}
