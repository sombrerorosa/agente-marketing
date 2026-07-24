import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildObjectStorySpec,
  CreateAdCreativeInput,
  CreateAdCreativeInputSchema,
  GetAdCreativeInput,
  GetAdCreativeInputSchema,
  ListAdCreativesInput,
  ListAdCreativesInputSchema,
  UploadImageInput,
  UploadImageInputSchema,
  UploadVideoInput,
  UploadVideoInputSchema,
} from "../schemas/creatives.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged, uploadMediaFile } from "../services/graphApiClient.js";
import type { AdCreative } from "../types.js";

const CREATIVE_FIELDS = "id,name,object_story_spec,thumbnail_url,status";

function renderCreativeMarkdown(c: AdCreative): string {
  return [`## ${c.name ?? "(unnamed)"} (\`${c.id}\`)`, `- **Status**: ${c.status ?? "n/a"}`, `- **Thumbnail**: ${c.thumbnail_url ?? "n/a"}`].join("\n");
}

export function registerCreativeTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_upload_image",
    {
      title: "Upload Meta Ads Image",
      description: `Upload an image to the ad account's image library, returning an image_hash for use in meta_ads_create_ad_creative.

Args:
  - file_path (string, optional): absolute local path to a JPG/PNG file
  - image_url (string, optional): publicly reachable HTTPS URL — Meta fetches it directly, no local read needed
  - response_format ('markdown'|'json', default markdown)
  Provide exactly one of file_path or image_url.

Returns { hash, url } — pass hash as image_hash to meta_ads_create_ad_creative.

Don't use when: the asset is a video — use meta_ads_upload_video instead.

Error Handling:
  - "did not return an image hash" if the file isn't a supported format (JPG/PNG) or is corrupted`,
      inputSchema: UploadImageInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: UploadImageInput) => {
      try {
        if (!params.file_path && !params.image_url) {
          return errorResponse("Error: Provide either file_path or image_url.");
        }
        if (params.file_path && params.image_url) {
          return errorResponse("Error: Provide only one of file_path or image_url, not both.");
        }

        const endpoint = `/${getAdAccountId()}/adimages`;
        const response = params.image_url
          ? await graphRequest<{ images: Record<string, { hash: string; url: string }> }>(endpoint, {
              method: "POST",
              params: { url: params.image_url },
            })
          : await uploadMediaFile<{ images: Record<string, { hash: string; url: string }> }>(endpoint, params.file_path!, "source");

        const entries = Object.entries(response.images ?? {});
        if (!entries.length) {
          return errorResponse("Error: Meta did not return an image hash — check the file is a valid JPG/PNG.");
        }
        const [, image] = entries[0];
        return buildResponse(
          { hash: image.hash, url: image.url },
          `Uploaded image — hash: \`${image.hash}\`\nPreview: ${image.url}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_upload_video",
    {
      title: "Upload Meta Ads Video",
      description: `Upload a video to the ad account's video library, returning a video_id for use in meta_ads_create_ad_creative.

Args:
  - file_path (string, optional): absolute local path to an MP4/MOV file
  - video_url (string, optional): publicly reachable HTTPS URL — Meta fetches it directly
  - name (string, optional): display name in Meta's video library
  - response_format ('markdown'|'json', default markdown)
  Provide exactly one of file_path or video_url.

Returns { video_id }. Meta processes video asynchronously — it is usually ready within a couple of minutes, but meta_ads_create_ad_creative may fail with a transient error if you try immediately after upload for a large file; retry after a short wait.

Don't use when: the asset is a still image — use meta_ads_upload_image instead. Also remember video creatives require a separate thumbnail image (upload it with meta_ads_upload_image and pass its hash as video_thumbnail_image_hash).`,
      inputSchema: UploadVideoInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: UploadVideoInput) => {
      try {
        if (!params.file_path && !params.video_url) {
          return errorResponse("Error: Provide either file_path or video_url.");
        }
        if (params.file_path && params.video_url) {
          return errorResponse("Error: Provide only one of file_path or video_url, not both.");
        }

        const endpoint = `/${getAdAccountId()}/advideos`;
        const titleField: Record<string, string> = params.name ? { title: params.name } : {};
        const response = params.video_url
          ? await graphRequest<{ id: string }>(endpoint, { method: "POST", params: { file_url: params.video_url, ...titleField } })
          : await uploadMediaFile<{ id: string }>(endpoint, params.file_path!, "source", titleField);

        return buildResponse(
          { video_id: response.id },
          `Uploaded video — video_id: \`${response.id}\`. Meta is processing it; it will be ready to use in a creative shortly.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_create_ad_creative",
    {
      title: "Create Meta Ads Ad Creative",
      description: `Build an Ad Creative (copy + media + destination + call to action) from an already-uploaded image or video, ready to attach to an ad via meta_ads_create_ad.

Args:
  - name, page_id, message, link_url: required
  - headline, link_description: optional supporting copy
  - call_to_action_type (string, default LEARN_MORE): e.g. SHOP_NOW, SIGN_UP, DOWNLOAD, CONTACT_US
  - image_hash (string): from meta_ads_upload_image — provide this OR video_id, not both
  - video_id (string): from meta_ads_upload_video
  - video_thumbnail_image_hash (string): required when video_id is set
  - instagram_actor_id (string, optional): also run on Instagram placements
  - response_format ('markdown'|'json', default markdown)

Returns the created creative's id.

Don't use when: you don't have an image_hash or video_id yet — run meta_ads_upload_image / meta_ads_upload_video first.

Error Handling:
  - Returns an error if neither image_hash nor video_id is provided, or if video_id is set without video_thumbnail_image_hash`,
      inputSchema: CreateAdCreativeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateAdCreativeInput) => {
      try {
        if (!params.image_hash && !params.video_id) {
          return errorResponse("Error: Provide either image_hash or video_id.");
        }
        if (params.image_hash && params.video_id) {
          return errorResponse("Error: Provide only one of image_hash or video_id, not both.");
        }
        if (params.video_id && !params.video_thumbnail_image_hash) {
          return errorResponse("Error: video_thumbnail_image_hash is required when video_id is set — upload a still frame with meta_ads_upload_image first.");
        }

        const objectStorySpec = buildObjectStorySpec(params);
        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/adcreatives`, {
          method: "POST",
          params: { name: params.name, object_story_spec: JSON.stringify(objectStorySpec) },
        });
        return buildResponse(
          { id: created.id, name: params.name },
          `Created ad creative **${params.name}** (\`${created.id}\`)`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_list_ad_creatives",
    {
      title: "List Meta Ads Ad Creatives",
      description: `List ad creatives in the configured ad account.

Read-only.

Args:
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListAdCreativesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAdCreativesInput) => {
      try {
        const paged = await listPaged<AdCreative>(`/${getAdAccountId()}/adcreatives`, { fields: CREATIVE_FIELDS }, params.limit);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ad creatives found in this ad account." }] };
        }
        const markdown = [`# Ad Creatives (${paged.count})`, "", ...paged.items.map(renderCreativeMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_get_ad_creative",
    {
      title: "Get Meta Ads Ad Creative",
      description: `Fetch full details for a single ad creative by ID, including its object_story_spec (copy, media, destination).

Args:
  - creative_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetAdCreativeInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdCreativeInput) => {
      try {
        const creative = await graphRequest<AdCreative>(`/${params.creative_id}`, { params: { fields: CREATIVE_FIELDS } });
        return buildResponse(creative as unknown as Record<string, unknown>, renderCreativeMarkdown(creative), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
