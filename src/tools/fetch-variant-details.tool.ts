import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ProductMapper } from "../db/product-mapper";
import type { Product } from "../schema/product";
import type { ToolDependencies } from "./tool-dependencies";

const schema = z.object({
    asin: z.string().describe("the parent ASIN whose /products file should be enriched"),
    limit: z.number().int().min(1).max(20).default(10).describe("cap on how many child variants to visit"),
});

export function createFetchVariantDetailsTool({ workspace, scraper }: ToolDependencies) {
    return tool(
        async ({ asin, limit }: z.infer<typeof schema>) => {
            const parent = await workspace.readJsonOrNull<Product>(`products/${asin}.json`);
            if (!parent) return `no /products/${asin}.json — scrape the parent with fetch_products first`;

            const self = parent.variants.combinations.find((entry) => entry.asin === asin);
            if (self && self.title === null) {
                self.title = parent.title;
                self.price = parent.price;
                self.currency = parent.currency;
                self.image = ProductMapper.primaryImage(parent);
                self.availability = parent.availability;
            }

            const targets = parent.variants.combinations
                .filter((entry) => entry.asin && entry.asin !== asin && entry.title === null)
                .slice(0, limit);

            if (!targets.length) {
                await workspace.writeJson(`products/${asin}.json`, parent);
                return `${asin}: nothing to enrich (${parent.variants.combinations.length} combinations already resolved)`;
            }

            const results = await Promise.allSettled(
                targets.map((target) => scraper.fetchProduct(target.asin)),
            );

            const lines: string[] = [];
            let filled = 0;

            for (const [index, result] of results.entries()) {
                const target = targets[index];

                if (result.status !== "fulfilled") {
                    const message = String(result.reason?.message ?? result.reason).split("\n")[0];
                    lines.push(`✗ ${target.asin}  ${message}`);
                    continue;
                }

                const entry = parent.variants.combinations.find((item) => item.asin === target.asin);
                if (!entry) continue;

                const child = result.value;
                entry.title = child.title;
                entry.price = child.price;
                entry.currency = child.currency;
                entry.image = ProductMapper.primaryImage(child);
                entry.availability = child.availability;
                filled++;

                const coordinates = Object.values(entry.values).join(" / ") || target.asin;
                const price = entry.price !== null ? `${entry.currency ?? ""}${entry.price}` : "no price";
                lines.push(`✓ ${target.asin}  ${coordinates}  ${price}`);
            }

            await workspace.writeJson(`products/${asin}.json`, parent);

            return [`${asin}: enriched ${filled}/${targets.length} variants`, ...lines].join("\n");
        },
        {
            name: "fetch_variant_details",
            description:
                "Visit each child variant of an already-scraped product and fill in that variant's own title, price, hero image " +
                "and availability, writing the result back into /products/<asin>.json. Only worth calling when the parent's " +
                "variant values came back without prices — the swatch prices on the parent page are often not rendered.",
            schema,
        },
    );
}
