import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const image_schema = z.object({
    url: z.string(),
    is_primary: z.boolean(),
});

const product_schema = z.object({
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
    scraped_at: z.string(),
    variants: z.array(z.object({
        asin: z.string(),
        label: z.string().nullable(),
        url: z.string(),
    })).default([]),
});

const write_schema = z.object({
    keyword: z.string().describe("search keyword these products came from"),
    tag: z.string().describe("amazon associates tracking tag"),
    products: z.array(product_schema),
    path: z.string().nullable().describe("output path; null for an auto-generated name under output/"),
});

const OUTPUT_DIR = "output";

function default_path(keyword: string) {
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${OUTPUT_DIR}/products_${slug}_${stamp}.json`;
}

async function write_products({ keyword, tag, products, path }: z.infer<typeof write_schema>) {
    const target = resolve(path ?? default_path(keyword));

    await mkdir(dirname(target), { recursive: true });

    const payload = {
        keyword,
        tag,
        generated_at: new Date().toISOString(),
        count: products.length,
        products,
    };

    await writeFile(target, JSON.stringify(payload, null, 2), "utf8");

    return `wrote ${products.length} products to ${target}`;
}

export const write_products_tool = tool(write_products, {
    name: "write_products",
    description: "Write the final ranked product list to a JSON file on disk.",
    schema: write_schema,
});

export { write_products, product_schema };
export type product = z.infer<typeof product_schema>;