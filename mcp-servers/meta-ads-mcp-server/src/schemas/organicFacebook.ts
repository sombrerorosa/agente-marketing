import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const CreateFacebookPostInputSchema = z
  .object({
    page_id: z.string().min(1).describe("Facebook Page ID to post as. Use meta_ads_list_pages to find it."),
    message: z.string().optional().describe("Post text. Required unless link or image_urls/video_url carry the content on their own."),
    link: z.string().url().optional().describe("URL to attach as a link preview. Only used for text/link posts — ignored if image_urls or video_url is set."),
    image_urls: z
      .array(z.string().url())
      .min(1)
      .max(10)
      .optional()
      .describe("1-10 publicly reachable HTTPS image URLs. A single URL posts as a photo post; more than one posts as a multi-photo post. Mutually exclusive with video_url."),
    video_url: z.string().url().optional().describe("Publicly reachable HTTPS video URL — Meta fetches it server-side. Mutually exclusive with image_urls."),
    scheduled_publish_time: z
      .string()
      .optional()
      .describe(
        "ISO 8601 datetime to schedule this post for instead of publishing immediately, e.g. '2026-11-01T09:00:00-03:00'. Meta enforces a scheduling window (commonly 10 minutes to 30 days out, longer for some video cases) — it'll reject anything outside its own current limits with a clear error."
      ),
    response_format: responseFormatField,
  })
  .strict()
  .refine((v) => v.message || v.link || v.image_urls?.length || v.video_url, {
    message: "Provide at least one of message, link, image_urls, or video_url.",
  })
  .refine((v) => !(v.image_urls?.length && v.video_url), {
    message: "image_urls and video_url are mutually exclusive — a post is either a photo post or a video post.",
    path: ["video_url"],
  });
export type CreateFacebookPostInput = z.infer<typeof CreateFacebookPostInputSchema>;

export const ListFacebookPostsInputSchema = z
  .object({
    page_id: z.string().min(1),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListFacebookPostsInput = z.infer<typeof ListFacebookPostsInputSchema>;

export const GetFacebookPostInputSchema = z
  .object({
    post_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetFacebookPostInput = z.infer<typeof GetFacebookPostInputSchema>;
