import { z } from "zod";

export const image_schema = z.object({
    url: z.string(),
    is_primary: z.boolean(),
});

/** One selectable value inside a dimension, e.g. the "Deep Sea Blue" colour swatch. */
export const variant_value_schema = z.object({
    asin: z.string(),
    label: z.string().nullable(),
    /** full-resolution swatch image, when the swatch is an image swatch */
    image: z.string().nullable(),
    /** the small ._SS64_ thumbnail amazon actually renders */
    thumb: z.string().nullable(),
    /** price shown on the swatch itself; amazon only renders this on some layouts */
    price: z.number().nullable(),
    available: z.boolean(),
    selected: z.boolean(),
});

/** One twister axis, e.g. color_name / size_name / configuration. */
export const variant_dimension_schema = z.object({
    key: z.string(),
    label: z.string().nullable(),
    selected: z.string().nullable(),
    values: z.array(variant_value_schema),
});

/**
 * One concrete child product = one point in the dimension cross-product.
 *
 * `title`/`price`/`image` are only populated once the child page itself has been
 * visited (see the fetch_variant_details tool) — the parent page does not carry them.
 */
export const variant_combination_schema = z.object({
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

export const variants_schema = z.object({
    parent_asin: z.string().nullable(),
    dimensions: z.array(variant_dimension_schema),
    combinations: z.array(variant_combination_schema),
    count: z.number(),
});

export const empty_variants: z.infer<typeof variants_schema> = {
    parent_asin: null,
    dimensions: [],
    combinations: [],
    count: 0,
};

export const product_schema = z.object({
    asin: z.string(),
    url: z.string(),
    affiliate_url: z.string(),
    title: z.string().nullable(),
    brand: z.string().nullable(),
    description: z.string().nullable(),
    price: z.number().nullable(),
    currency: z.string().nullable(),
    list_price: z.number().nullable(),
    rating: z.number().nullable(),
    review_count: z.number().nullable(),
    availability: z.string().nullable(),
    is_prime: z.boolean(),
    coupon: z.string().nullable(),
    images: z.array(image_schema),
    variants: variants_schema,
    scraped_at: z.string(),
});

/** What a search results card gives us before we ever open the detail page. */
export const candidate_schema = z.object({
    asin: z.string(),
    title: z.string().nullable(),
    price: z.number().nullable(),
    rating: z.number().nullable(),
    review_count: z.number().nullable(),
    image: z.string().nullable(),
    sponsored: z.boolean(),
    page: z.number(),
});

export type image = z.infer<typeof image_schema>;
export type variants = z.infer<typeof variants_schema>;
export type product = z.infer<typeof product_schema>;
export type candidate = z.infer<typeof candidate_schema>;
