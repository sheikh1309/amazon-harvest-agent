import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { read_json, workspace_path } from "../lib/workspace";
import { dedup_key, score } from "../lib/amazon";
import { config } from "../lib/config";
import type { product } from "../schema/product";

const schema = z.object({
    min_rating: z.number().default(config.min_rating),
    min_reviews: z.number().default(config.min_reviews),
    limit: z.number().int().min(1).default(config.final_count),
    require_price: z.boolean().default(false)
        .describe("drop products with no price; leave false when scraping from a region where items are unbuyable"),
});

async function run({ min_rating, min_reviews, limit, require_price }: z.infer<typeof schema>) {
    let files: string[];
    try {
        files = (await readdir(workspace_path("products"))).filter((f) => f.endsWith(".json"));
    } catch {
        return "no /products directory yet — run fetch_products first";
    }

    const products: product[] = [];
    for (const file of files) {
        try {
            products.push(await read_json<product>(`products/${file}`));
        } catch {
            /* a half-written file is not worth failing the whole ranking over */
        }
    }

    const passed = products.filter(
        (p) =>
            (p.rating ?? 0) >= min_rating &&
            (p.review_count ?? 0) >= min_reviews &&
            (!require_price || p.price != null),
    );

    // Scoring and dedup are arithmetic, so they belong in code — asking the model to
    // sort by rating × log(reviews) is slower and not reproducible.
    const seen = new Set<string>();
    const ranked = passed
        .sort((a, b) => score(b) - score(a))
        .filter((p) => {
            const key = dedup_key(p);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, limit);

    const lines = ranked.map(
        (p, i) =>
            `${String(i + 1).padStart(2)}. ${p.asin}  score ${score(p).toFixed(2)}  ` +
            `${p.rating ?? "-"}★ (${p.review_count ?? "-"})  ` +
            `${p.price != null ? `${p.currency ?? ""}${p.price}` : "no price"}  ${p.title?.slice(0, 55) ?? ""}`,
    );

    return [
        `${products.length} scraped → ${passed.length} pass filters → ${ranked.length} after dedup`,
        `ranked asins: ${ranked.map((p) => p.asin).join(", ")}`,
        "",
        ...lines,
    ].join("\n");
}

export const rank_products = tool(run, {
    name: "rank_products",
    description:
        "Read every product written to /products, apply the quality bar, rank by rating weighted by review volume, " +
        "drop near-duplicate titles, and return the top N as a compact table. Use this instead of reading the product " +
        "files yourself — it is exact arithmetic and keeps the payloads out of context.",
    schema,
});
