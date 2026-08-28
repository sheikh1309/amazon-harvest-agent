import { z } from "zod";

export const buyingGuideSectionSchema = z.object({
    heading: z.string().min(1),
    content: z.string().min(1),
});

export const buyingGuideSchema = z.object({
    title: z.string().min(1),
    sections: z.array(buyingGuideSectionSchema).min(2),
});

export const faqItemSchema = z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
});

export const pageProductSchema = z.object({
    asin: z.string().min(1),
    enhanced_title: z.string().min(1),
    key_features: z.array(z.string().min(1)).min(3).max(6),
});

export const pageCopySchema = z.object({
    parent_category: z.string().min(1),
    page_title: z.string().min(1),
    meta_description: z.string().min(1),
    h1_title: z.string().min(1),
    introduction: z.string().min(1),
    conclusion: z.string().min(1),
    buying_guide: buyingGuideSchema,
    faq: z.array(faqItemSchema).min(3),
});

export const pageContentSchema = pageCopySchema.extend({
    products: z.array(pageProductSchema).min(1),
});

export type BuyingGuide = z.infer<typeof buyingGuideSchema>;
export type FaqItem = z.infer<typeof faqItemSchema>;
export type PageProduct = z.infer<typeof pageProductSchema>;
export type PageCopy = z.infer<typeof pageCopySchema>;
export type PageContent = z.infer<typeof pageContentSchema>;
