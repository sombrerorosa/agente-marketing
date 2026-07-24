import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const CallToActionEnum = z.enum([
  "SHOP_NOW",
  "LEARN_MORE",
  "SIGN_UP",
  "DOWNLOAD",
  "BOOK_TRAVEL",
  "CONTACT_US",
  "SUBSCRIBE",
  "GET_QUOTE",
  "APPLY_NOW",
  "WATCH_MORE",
  "SEND_MESSAGE",
  "CALL_NOW",
]);

export const UploadImageInputSchema = z
  .object({
    image_url: z.string().url().describe("Publicly reachable HTTPS URL — Meta fetches it server-side. Use a hosted asset (e.g. from Canva/Higgsfield output) rather than a local file."),
    response_format: responseFormatField,
  })
  .strict();
export type UploadImageInput = z.infer<typeof UploadImageInputSchema>;

export const UploadVideoInputSchema = z
  .object({
    video_url: z.string().url().describe("Publicly reachable HTTPS URL — Meta fetches it server-side."),
    name: z.string().optional().describe("Display name for the video asset in Meta's Ads Manager library."),
    response_format: responseFormatField,
  })
  .strict();
export type UploadVideoInput = z.infer<typeof UploadVideoInputSchema>;

export const CreateAdCreativeInputSchema = z
  .object({
    name: z.string().min(1).max(400).describe("Internal name for this creative, shown in Ads Manager (not visible to end users)."),
    page_id: z.string().min(1).describe("Facebook Page ID that appears as the ad's sender. Use meta_ads_list_pages to find it."),
    message: z.string().min(1).describe("Primary ad text — the main copy shown above the media."),
    headline: z.string().optional().describe("Short headline shown below the media."),
    link_description: z.string().optional().describe("Secondary description text shown under the headline."),
    link_url: z.string().url().describe("Destination URL when someone clicks the ad."),
    call_to_action_type: CallToActionEnum.default("LEARN_MORE"),
    image_hash: z.string().optional().describe("From meta_ads_upload_image. Provide this for an image ad; omit if using video_id instead."),
    video_id: z.string().optional().describe("From meta_ads_upload_video. Provide this for a video ad; omit if using image_hash instead."),
    video_thumbnail_image_hash: z
      .string()
      .optional()
      .describe("Required when video_id is set — thumbnail shown before playback, from meta_ads_upload_image."),
    instagram_actor_id: z.string().optional().describe("Instagram Business Account ID, to also run this creative on Instagram placements."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateAdCreativeInput = z.infer<typeof CreateAdCreativeInputSchema>;

export const ListAdCreativesInputSchema = z
  .object({
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAdCreativesInput = z.infer<typeof ListAdCreativesInputSchema>;

export const GetAdCreativeInputSchema = z
  .object({
    creative_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetAdCreativeInput = z.infer<typeof GetAdCreativeInputSchema>;

export function buildObjectStorySpec(params: CreateAdCreativeInput): Record<string, unknown> {
  const cta = { type: params.call_to_action_type, value: { link: params.link_url } };
  const spec: Record<string, unknown> = { page_id: params.page_id };
  if (params.instagram_actor_id) spec.instagram_actor_id = params.instagram_actor_id;

  if (params.video_id) {
    spec.video_data = {
      video_id: params.video_id,
      title: params.headline,
      message: params.message,
      link_description: params.link_description,
      image_hash: params.video_thumbnail_image_hash,
      call_to_action: cta,
    };
  } else {
    spec.link_data = {
      link: params.link_url,
      message: params.message,
      name: params.headline,
      description: params.link_description,
      image_hash: params.image_hash,
      call_to_action: cta,
    };
  }
  return spec;
}
