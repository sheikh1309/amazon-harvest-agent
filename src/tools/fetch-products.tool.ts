import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Product } from "../schema/product";
import type { ToolDependencies } from "./tool-dependencies";

const schema = z.object({
    asins: z
        .array(z.string())
        .min(1)
        .max(25)
        .describe("ASINs to scrape; they are fetched concurrently, so pass a batch rather than one at a time"),
});

function summarise(product: Product): string {
    const variantNote = product.variants.dimensions.length
        ? `  variants: ${product.variants.dimensions.map((d) => `${d.key}×${d.values.length}`).join(" ")}`
        : "";

    return (
        `✓ ${product.asin}  ${product.rating ?? "-"}★ ${product.review_count ?? "-"} rev  ` +
        `${product.price !== null ? `${product.currency ?? ""}${product.price}` : "no price"}  ` +
        `${product.images.length} imgs${variantNote}  ${product.title?.slice(0, 45) ?? ""}`
    );
}

export function createFetchProductsTool({ workspace, scraper }: ToolDependencies) {
    return tool(
        async ({ asins }: z.infer<typeof schema>) => {
            const results = await Promise.allSettled(asins.map((asin) => scraper.fetchProduct(asin)));

            const lines: string[] = [];
            let succeeded = 0;

            for (const [index, result] of results.entries()) {
                const asin = asins[index];

                if (result.status === "fulfilled") {
                    await workspace.writeJson(`products/${asin}.json`, result.value);
                    lines.push(summarise(result.value));
                    succeeded++;
                } else {
                    const message = String(result.reason?.message ?? result.reason).split("\n")[0];
                    lines.push(`✗ ${asin}  ${message}`);
                }
            }

            return [
                `${succeeded}/${asins.length} scraped, each written to /products/<asin>.json`,
                "",
                ...lines,
            ].join("\n");
        },
        {
            name: "fetch_products",
            description:
                "Scrape full detail pages for a batch of ASINs: title, brand, bullets, price, rating, reviews, availability, " +
                "all gallery images, and the complete variant matrix (every dimension such as colour/size/style, each value's " +
                "swatch image, text label and price, plus every child ASIN). Writes one file per product to /products/<asin>.json " +
                "and returns only a one-line summary each, so the full payload never enters the conversation. " +
                "Always send ASINs in batches — they are fetched in parallel.",
            schema,
        },
    );
}
