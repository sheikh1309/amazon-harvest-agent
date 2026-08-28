import { z } from "zod";

export const imageSchema = z.object({
    url: z.string(),
    is_primary: z.boolean(),
});

export const variantValueSchema = z.object({
    asin: z.string(),
    label: z.string().nullable(),
    image: z.string().nullable(),
    thumb: z.string().nullable(),
    price: z.number().nullable(),
    available: z.boolean(),
    selected: z.boolean(),
});

export const variantDimensionSchema = z.object({
    key: z.string(),
    label: z.string().nullable(),
    selected: z.string().nullable(),
    values: z.array(variantValueSchema),
});

export const variantCombinationSchema = z.object({
    asin: z.string(),
    values: z.record(z.string(), z.string()),
    url: z.string(),
    affiliate_url: z.string(),
    title: z.string().nullable().default(null),
    price: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    image: z.string().nullable().default(null),
    availability: z.string().nullable().default(null),
});

export const variantsSchema = z.object({
    parent_asin: z.string().nullable(),
    dimensions: z.array(variantDimensionSchema),
    combinations: z.array(variantCombinationSchema),
    count: z.number(),
});

export const productSchema = z.object({
    asin: z.string(),
    url: z.string(),
    affiliate_url: z.string(),
    title: z.string().nullable(),
    brand: z.string().nullable(),
    description: z.string().nullable(),
    features: z.array(z.string()).default([]),
    price: z.number().nullable(),
    currency: z.string().nullable(),
    list_price: z.number().nullable(),
    rating: z.number().nullable(),
    review_count: z.number().nullable(),
    availability: z.string().nullable(),
    is_prime: z.boolean(),
    coupon: z.string().nullable(),
    images: z.array(imageSchema),
    variants: variantsSchema,
    scraped_at: z.string(),
});

export const candidateSchema = z.object({
    asin: z.string(),
    title: z.string().nullable(),
    price: z.number().nullable(),
    rating: z.number().nullable(),
    review_count: z.number().nullable(),
    image: z.string().nullable(),
    sponsored: z.boolean(),
    page: z.number(),
});

export type ProductImage = z.infer<typeof imageSchema>;
export type ProductVariants = z.infer<typeof variantsSchema>;
export type Product = z.infer<typeof productSchema>;
export type Candidate = z.infer<typeof candidateSchema>;

export const EMPTY_VARIANTS: ProductVariants = {
    parent_asin: null,
    dimensions: [],
    combinations: [],
    count: 0,
};
