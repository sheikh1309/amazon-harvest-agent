import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ProductMapper } from "../db/product-mapper";
import { collapseWhitespace } from "../lib/text";
import type { Product } from "../schema/product";
import type { ToolDependencies } from "./tool-dependencies";

const schema = z.object({
    asins: z.array(z.string()).min(1).describe("ASINs to summarise, normally the final shortlist in ranked order"),
    bullets: z
        .number()
        .int()
        .min(0)
        .max(8)
        .default(5)
        .describe("how many feature bullets to include per product"),
});

function brief(product: Product, bulletCount: number): string {
    const price = product.price !== null ? `${product.currency ?? "$"}${product.price}` : "no price";
    const brand = ProductMapper.brand(product) ?? "unknown";

    const lines = [
        `${product.asin} | ${product.title ?? "(no title)"}`,
        `  brand: ${brand} · ${price} · ${product.rating ?? "-"}★ · ${product.review_count ?? "-"} reviews` +
            (product.is_prime ? " · prime" : "") +
            (product.coupon ? " · coupon" : ""),
    ];

    for (const bullet of (product.features ?? []).slice(0, bulletCount)) {
        lines.push(`  - ${collapseWhitespace(bullet).slice(0, 180)}`);
    }

    if (product.variants.dimensions.length) {
        const axes = product.variants.dimensions
            .map((dimension) => `${dimension.label ?? dimension.key} ×${dimension.values.length}`)
            .join(", ");
        lines.push(`  variants: ${axes}`);
    }

    return lines.join("\n");
}

export function createProductBriefsTool({ workspace }: ToolDependencies) {
    return tool(
        async ({ asins, bullets }: z.infer<typeof schema>) => {
            const briefs: string[] = [];
            const missing: string[] = [];

            for (const asin of asins) {
                const product = await workspace.readJsonOrNull<Product>(`products/${asin}.json`);
                if (product) briefs.push(brief(product, bullets));
                else missing.push(asin);
            }

            if (!briefs.length) return `no scraped files for any of: ${asins.join(", ")}`;

            return [
                briefs.join("\n\n"),
                missing.length ? `\nmissing (not scraped): ${missing.join(", ")}` : "",
            ]
                .filter(Boolean)
                .join("\n");
        },
        {
            name: "product_briefs",
            description:
                "Compact summary of scraped products — title, brand, price, rating, review count, feature bullets and " +
                "variant axes — for writing page copy. Use this instead of reading /products/<asin>.json, which is far " +
                "larger than anything the copy needs.",
            schema,
        },
    );
}
