import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IG_CONTAINER_POLL_INTERVAL_MS, IG_CONTAINER_POLL_MAX_ATTEMPTS } from "../constants.js";
import {
  CreateInstagramCarouselInput,
  CreateInstagramCarouselInputSchema,
  CreateInstagramPostInput,
  CreateInstagramPostInputSchema,
  GetInstagramContainerStatusInput,
  GetInstagramContainerStatusInputSchema,
  GetInstagramMediaInput,
  GetInstagramMediaInputSchema,
  ListInstagramMediaInput,
  ListInstagramMediaInputSchema,
  PublishInstagramContainerInput,
  PublishInstagramContainerInputSchema,
} from "../schemas/organicInstagram.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { graphRequest, listPaged } from "../services/graphApiClient.js";
import type { ContainerStatus, InstagramMedia, MediaContainer } from "../types.js";

const MEDIA_FIELDS = "id,caption,media_type,media_url,permalink,timestamp";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderMediaMarkdown(m: InstagramMedia): string {
  return [
    `## Media \`${m.id}\``,
    `- **Type**: ${m.media_type ?? "n/a"}`,
    `- **Caption**: ${m.caption ?? "n/a"}`,
    `- **Posted**: ${m.timestamp ?? "n/a"}`,
    `- **Link**: ${m.permalink ?? "n/a"}`,
  ].join("\n");
}

/**
 * Polls a container's processing status. Images are ready the instant
 * they're created; video/Reels containers process asynchronously, so this
 * is only meaningfully async for those. Gives up after
 * IG_CONTAINER_POLL_MAX_ATTEMPTS rather than following Meta's own guidance
 * of polling for up to 5 minutes — nothing in a chat turn should block that
 * long, so a timeout here just means "still processing," not an error.
 */
async function waitForContainerReady(containerId: string): Promise<ContainerStatus> {
  let status: ContainerStatus = { id: containerId, status_code: "IN_PROGRESS" };
  for (let attempt = 0; attempt < IG_CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
    status = await graphRequest<ContainerStatus>(`/${containerId}`, { params: { fields: "status_code,status" } });
    if (status.status_code !== "IN_PROGRESS") return status;
    await sleep(IG_CONTAINER_POLL_INTERVAL_MS);
  }
  return status;
}

export function registerOrganicInstagramTools(server: McpServer): void {
  server.registerTool(
    "meta_organic_create_ig_post",
    {
      title: "Create Organic Instagram Post",
      description: `Publish an organic image or video (Reel) post to an Instagram Business Account. Instagram's publishing API is container-based: create a media container, wait for it to finish processing (video only), then publish it — this tool does all three steps, auto-publishing if processing finishes quickly.

This is free reach, not a paid ad.

Args:
  - ig_user_id (string): required. Use meta_organic_get_instagram_account to find it from a Page ID.
  - caption (string, optional)
  - image_url (string, optional): mutually exclusive with video_url
  - video_url (string, optional): mutually exclusive with image_url. Published as a Reel — Instagram no longer has a separate plain "video post" type.
  - cover_url (string, optional): thumbnail for a video post
  - share_to_feed (boolean, default true): also show the Reel in the main feed grid, not just the Reels tab
  - response_format ('markdown'|'json', default markdown)

Returns the published media's id — or, if a video container is still processing after a bounded wait, the creation_id to check with meta_organic_get_instagram_container_status and publish later with meta_organic_publish_instagram_container.

There's no native scheduling for Instagram via this API (unlike meta_organic_create_fb_post for Facebook) — Meta doesn't expose a scheduled-publish parameter on this endpoint.

Error Handling:
  - "Permission denied" if the token lacks instagram_content_publish for this account
  - Container status ERROR/EXPIRED means the media itself was rejected (format, size, or policy) — check the returned detail`,
      inputSchema: CreateInstagramPostInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateInstagramPostInput) => {
      try {
        const container = await graphRequest<MediaContainer>(`/${params.ig_user_id}/media`, {
          method: "POST",
          params: params.video_url
            ? {
                video_url: params.video_url,
                media_type: "REELS",
                caption: params.caption,
                cover_url: params.cover_url,
                share_to_feed: params.share_to_feed,
              }
            : { image_url: params.image_url, caption: params.caption },
        });

        if (params.video_url) {
          const status = await waitForContainerReady(container.id);
          if (status.status_code === "IN_PROGRESS") {
            return buildResponse(
              { creation_id: container.id, status: status.status_code },
              `Video container \`${container.id}\` is still processing. Check meta_organic_get_instagram_container_status, then publish it with meta_organic_publish_instagram_container once it's FINISHED.`,
              params.response_format
            );
          }
          if (status.status_code !== "FINISHED") {
            return errorResponse(`Error: Container ${container.id} ended in status ${status.status_code}${status.status ? ` — ${status.status}` : ""}.`);
          }
        }

        const published = await graphRequest<{ id: string }>(`/${params.ig_user_id}/media_publish`, {
          method: "POST",
          params: { creation_id: container.id },
        });
        return buildResponse(
          { id: published.id, ig_user_id: params.ig_user_id },
          `Published Instagram ${params.video_url ? "Reel" : "post"} \`${published.id}\`.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_create_ig_carousel",
    {
      title: "Create Organic Instagram Carousel Post",
      description: `Publish an organic carousel post (2-10 images/videos swiped through as one post) to an Instagram Business Account. Creates one child container per item, waits for any video children to finish processing, then creates and publishes the parent carousel container.

Args:
  - ig_user_id (string): required
  - caption (string, optional): applies to the whole carousel, not individual items
  - items (array): 2-10 entries, each { image_url } or { video_url }
  - response_format ('markdown'|'json', default markdown)

Returns the published media's id — or, if the carousel container wasn't ready to publish yet (rare — children are awaited first), its creation_id to publish later with meta_organic_publish_instagram_container.

Error Handling:
  - If any child item errors out, the whole carousel is abandoned — none of it publishes partially`,
      inputSchema: CreateInstagramCarouselInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateInstagramCarouselInput) => {
      try {
        const children = await Promise.all(
          params.items.map(async (item) => {
            const child = await graphRequest<MediaContainer>(`/${params.ig_user_id}/media`, {
              method: "POST",
              params: item.video_url
                ? { video_url: item.video_url, media_type: "VIDEO", is_carousel_item: true }
                : { image_url: item.image_url, is_carousel_item: true },
            });
            if (item.video_url) {
              const status = await waitForContainerReady(child.id);
              if (status.status_code !== "FINISHED") {
                throw new Error(`Carousel item ${child.id} ended in status ${status.status_code} before the carousel could be assembled.`);
              }
            }
            return child.id;
          })
        );

        const parent = await graphRequest<MediaContainer>(`/${params.ig_user_id}/media`, {
          method: "POST",
          params: { media_type: "CAROUSEL", caption: params.caption, children: children.join(",") },
        });

        const published = await graphRequest<{ id: string }>(`/${params.ig_user_id}/media_publish`, {
          method: "POST",
          params: { creation_id: parent.id },
        });
        return buildResponse(
          { id: published.id, ig_user_id: params.ig_user_id, item_count: children.length },
          `Published Instagram carousel \`${published.id}\` (${children.length} items).`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_publish_instagram_container",
    {
      title: "Publish Instagram Media Container",
      description: `Publish a previously created media container — the manual fallback for when meta_organic_create_ig_post/create_ig_carousel returned a creation_id instead of auto-publishing because processing hadn't finished yet.

Args:
  - ig_user_id (string): required
  - creation_id (string): required
  - response_format ('markdown'|'json', default markdown)

Error Handling:
  - "Invalid parameter" (media not ready) if the container hasn't reached FINISHED yet — check meta_organic_get_instagram_container_status first
  - Containers expire ~24h after creation if never published`,
      inputSchema: PublishInstagramContainerInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: PublishInstagramContainerInput) => {
      try {
        const published = await graphRequest<{ id: string }>(`/${params.ig_user_id}/media_publish`, {
          method: "POST",
          params: { creation_id: params.creation_id },
        });
        return buildResponse({ id: published.id }, `Published Instagram media \`${published.id}\`.`, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_get_instagram_container_status",
    {
      title: "Get Instagram Media Container Status",
      description: `Check a media container's processing status.

Read-only.

Args:
  - creation_id (string): required
  - response_format ('markdown'|'json', default markdown)

Returns status_code: IN_PROGRESS, FINISHED (ready to publish), ERROR, EXPIRED, or PUBLISHED (already published).`,
      inputSchema: GetInstagramContainerStatusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetInstagramContainerStatusInput) => {
      try {
        const status = await graphRequest<ContainerStatus>(`/${params.creation_id}`, { params: { fields: "status_code,status" } });
        return buildResponse(
          status as unknown as Record<string, unknown>,
          `Container \`${params.creation_id}\`: **${status.status_code}**${status.status ? ` — ${status.status}` : ""}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_list_instagram_media",
    {
      title: "List Organic Instagram Media",
      description: `List published posts on an Instagram Business Account.

Read-only.

Args:
  - ig_user_id (string): required
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListInstagramMediaInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListInstagramMediaInput) => {
      try {
        const paged = await listPaged<InstagramMedia>(`/${params.ig_user_id}/media`, { fields: MEDIA_FIELDS }, params.limit);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No media found on this Instagram account." }] };
        }
        const markdown = [`# Instagram Media (${paged.count})`, "", ...paged.items.map(renderMediaMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_get_instagram_media",
    {
      title: "Get Organic Instagram Media",
      description: `Fetch full details for a single published Instagram media item by ID.

Args:
  - media_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetInstagramMediaInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetInstagramMediaInput) => {
      try {
        const media = await graphRequest<InstagramMedia>(`/${params.media_id}`, { params: { fields: MEDIA_FIELDS } });
        return buildResponse(media as unknown as Record<string, unknown>, renderMediaMarkdown(media), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
