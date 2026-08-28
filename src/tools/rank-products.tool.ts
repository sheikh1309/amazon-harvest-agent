import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ProductRanker } from "../lib/product-ranker";
import type { Product } from "../schema/product";
import type { ToolDependencies } from "./tool-dependencies";

export function createRankProductsTool({ config, workspace, ranker }: ToolDependencies) {
    const schema = z.object({
        min_rating: z.number().default(config.minRating),
        min_reviews: z.number().default(config.minReviews),
        limit: z.number().int().min(1).default(config.finalCount),
        require_price: z
            .boolean()
            .default(false)
            .describe("drop products with no price; leave false when scraping from a region where items are unbuyable"),
    });

    return tool(
        async ({ min_rating, min_reviews, limit, require_price }: z.infer<typeof schema>) => {
            const asins = await workspace.scrapedAsins();
            if (!asins.length) return "no /products directory yet — run fetch_products first";

            const products: Product[] = [];
            for (const asin of asins) {
                const product = await workspace.readJsonOrNull<Product>(`products/${asin}.json`);
                if (product) products.push(product);
            }

            const { considered, passedFilters, ranked } = ranker.rank(products, {
                minRating: min_rating,
                minReviews: min_reviews,
                limit,
                requirePrice: require_price,
            });

            const lines = ranked.map((product, index) => {
                const price =
                    product.price !== null ? `${product.currency ?? ""}${product.price}` : "no price";
                return (
                    `${String(index + 1).padStart(2)}. ${product.asin}  ` +
                    `score ${ProductRanker.score(product).toFixed(2)}  ` +
                    `${product.rating ?? "-"}★ (${product.review_count ?? "-"})  ` +
                    `${price}  ${product.title?.slice(0, 55) ?? ""}`
                );
            });

            return [
                `${considered} scraped → ${passedFilters} pass filters → ${ranked.length} after dedup`,
                `ranked asins: ${ranked.map((product) => product.asin).join(", ")}`,
                "",
                ...lines,
            ].join("\n");
        },
        {
            name: "rank_products",
            description:
                "Read every product written to /products, apply the quality bar, rank by rating weighted by review volume, " +
                "drop near-duplicate titles, and return the top N as a compact table. Use this instead of reading the product " +
                "files yourself — it is exact arithmetic and keeps the payloads out of context.",
            schema,
        },
    );
}
