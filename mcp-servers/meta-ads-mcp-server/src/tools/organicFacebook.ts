import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateFacebookPostInput,
  CreateFacebookPostInputSchema,
  GetFacebookPostInput,
  GetFacebookPostInputSchema,
  ListFacebookPostsInput,
  ListFacebookPostsInputSchema,
} from "../schemas/organicFacebook.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { graphRequest, listPaged } from "../services/graphApiClient.js";
import type { FacebookPost } from "../types.js";

const POST_FIELDS = "id,message,story,status_type,permalink_url,created_time,scheduled_publish_time,is_published";

function renderPostMarkdown(p: FacebookPost): string {
  return [
    `## Post \`${p.id}\``,
    `- **Status**: ${p.is_published === false ? "scheduled" : "published"}`,
    `- **Message**: ${p.message ?? p.story ?? "n/a"}`,
    `- **Created**: ${p.created_time ?? "n/a"}${p.scheduled_publish_time ? ` (scheduled for ${p.scheduled_publish_time})` : ""}`,
    `- **Link**: ${p.permalink_url ?? "n/a"}`,
  ].join("\n");
}

/** Uploads one photo unpublished (for later attachment to a multi-photo feed post) and returns its media id. */
async function uploadUnpublishedPhoto(pageId: string, imageUrl: string, forScheduledPost: boolean): Promise<string> {
  const photo = await graphRequest<{ id: string }>(`/${pageId}/photos`, {
    method: "POST",
    params: {
      url: imageUrl,
      published: false,
      no_story: true,
      // Meta only keeps unpublished photos ~24h, and requires this flag
      // specifically when the photo will end up in a *scheduled* post.
      ...(forScheduledPost ? { temporary: true } : {}),
    },
  });
  return photo.id;
}

export function registerOrganicFacebookTools(server: McpServer): void {
  server.registerTool(
    "meta_organic_create_fb_post",
    {
      title: "Create Organic Facebook Page Post",
      description: `Publish (or schedule) an organic post to a Facebook Page's feed — text, link, photo(s), or video. This is free reach, not a paid ad; don't confuse it with meta_ads_create_ad.

Args:
  - page_id (string): required
  - message (string, optional): post text. Required unless link/image_urls/video_url carry the content.
  - link (string, optional): URL for a link preview. Ignored if image_urls or video_url is set.
  - image_urls (string[], optional): 1-10 public HTTPS image URLs. One URL = single photo post; more = multi-photo post. Mutually exclusive with video_url.
  - video_url (string, optional): public HTTPS video URL. Mutually exclusive with image_urls. Posts as a regular Page video, not specifically to the Reels tab — Meta's newer Reels-specific publishing API isn't wired up here yet.
  - scheduled_publish_time (string, optional): ISO 8601 datetime to schedule instead of publishing now.
  - response_format ('markdown'|'json', default markdown)

Returns the created (or scheduled) post's id.

Don't use when: you want to post to Instagram — use meta_organic_create_ig_post instead, the publishing flow is completely different (container-based).

Error Handling:
  - "Permission denied" if the token lacks pages_manage_posts for this Page
  - "Invalid parameter" if scheduled_publish_time is outside Meta's current allowed window`,
      inputSchema: CreateFacebookPostInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateFacebookPostInput) => {
      try {
        const scheduled = Boolean(params.scheduled_publish_time);
        const scheduleParams = scheduled
          ? { published: false, scheduled_publish_time: params.scheduled_publish_time }
          : { published: true };

        let result: { id: string; post_id?: string };

        if (params.video_url) {
          result = await graphRequest(`/${params.page_id}/videos`, {
            method: "POST",
            params: { file_url: params.video_url, description: params.message, ...scheduleParams },
          });
        } else if (params.image_urls && params.image_urls.length === 1) {
          result = await graphRequest(`/${params.page_id}/photos`, {
            method: "POST",
            params: { url: params.image_urls[0], caption: params.message, ...scheduleParams },
          });
        } else if (params.image_urls && params.image_urls.length > 1) {
          const photoIds = await Promise.all(params.image_urls.map((url) => uploadUnpublishedPhoto(params.page_id, url, scheduled)));
          result = await graphRequest(`/${params.page_id}/feed`, {
            method: "POST",
            params: {
              message: params.message,
              attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
              ...scheduleParams,
              ...(scheduled ? { unpublished_content_type: "SCHEDULED" } : {}),
            },
          });
        } else {
          result = await graphRequest(`/${params.page_id}/feed`, {
            method: "POST",
            params: { message: params.message, link: params.link, ...scheduleParams },
          });
        }

        const postId = result.post_id ?? result.id;
        return buildResponse(
          { id: postId, page_id: params.page_id, scheduled },
          `${scheduled ? `Scheduled post \`${postId}\` for ${params.scheduled_publish_time}` : `Published post \`${postId}\``} on Page \`${params.page_id}\`.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_list_fb_posts",
    {
      title: "List Organic Facebook Page Posts",
      description: `List organic posts on a Facebook Page's feed.

Read-only.

Args:
  - page_id (string): required
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListFacebookPostsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListFacebookPostsInput) => {
      try {
        const paged = await listPaged<FacebookPost>(`/${params.page_id}/posts`, { fields: POST_FIELDS }, params.limit);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No posts found on this Page." }] };
        }
        const markdown = [`# Posts (${paged.count})`, "", ...paged.items.map(renderPostMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_get_fb_post",
    {
      title: "Get Organic Facebook Page Post",
      description: `Fetch full details for a single Facebook post by ID.

Args:
  - post_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetFacebookPostInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetFacebookPostInput) => {
      try {
        const post = await graphRequest<FacebookPost>(`/${params.post_id}`, { params: { fields: POST_FIELDS } });
        return buildResponse(post as unknown as Record<string, unknown>, renderPostMarkdown(post), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
