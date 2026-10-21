import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const CreateInstagramPostInputSchema = z
  .object({
    ig_user_id: z.string().min(1).describe("Instagram Business Account ID. Use meta_organic_get_instagram_account to find it from a Page ID."),
    caption: z.string().optional(),
    image_url: z.string().url().optional().describe("Publicly reachable HTTPS image URL. Mutually exclusive with video_url."),
    video_url: z
      .string()
      .url()
      .optional()
      .describe("Publicly reachable HTTPS video URL — published as a Reel (Instagram's current default for all video). Mutually exclusive with image_url."),
    cover_url: z.string().url().optional().describe("Thumbnail image URL for a video post. Only used with video_url."),
    share_to_feed: z.boolean().default(true).describe("Whether a video/Reel also appears in the main feed grid, not just the Reels tab. Only used with video_url."),
    response_format: responseFormatField,
  })
  .strict()
  .refine((v) => Boolean(v.image_url) !== Boolean(v.video_url), {
    message: "Provide exactly one of image_url or video_url.",
    path: ["video_url"],
  });
export type CreateInstagramPostInput = z.infer<typeof CreateInstagramPostInputSchema>;

const CarouselItemSchema = z
  .object({
    image_url: z.string().url().optional(),
    video_url: z.string().url().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.image_url) !== Boolean(v.video_url), {
    message: "Each carousel item needs exactly one of image_url or video_url.",
  });

export const CreateInstagramCarouselInputSchema = z
  .object({
    ig_user_id: z.string().min(1),
    caption: z.string().optional(),
    items: z.array(CarouselItemSchema).min(2).max(10).describe("2-10 items, each an image or a video. Instagram's own carousel limit is 10."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateInstagramCarouselInput = z.infer<typeof CreateInstagramCarouselInputSchema>;

export const PublishInstagramContainerInputSchema = z
  .object({
    ig_user_id: z.string().min(1),
    creation_id: z.string().min(1).describe("Container id returned by meta_organic_create_ig_post/create_ig_carousel when it wasn't ready to auto-publish."),
    response_format: responseFormatField,
  })
  .strict();
export type PublishInstagramContainerInput = z.infer<typeof PublishInstagramContainerInputSchema>;

export const GetInstagramContainerStatusInputSchema = z
  .object({
    creation_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetInstagramContainerStatusInput = z.infer<typeof GetInstagramContainerStatusInputSchema>;

export const ListInstagramMediaInputSchema = z
  .object({
    ig_user_id: z.string().min(1),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListInstagramMediaInput = z.infer<typeof ListInstagramMediaInputSchema>;

export const GetInstagramMediaInputSchema = z
  .object({
    media_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetInstagramMediaInput = z.infer<typeof GetInstagramMediaInputSchema>;
