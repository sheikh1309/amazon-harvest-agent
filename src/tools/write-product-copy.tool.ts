import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { pageProductSchema, type PageProduct } from "../schema/page";
import type { ToolDependencies } from "./tool-dependencies";

export const PAGE_PRODUCTS_PATH = "page/products.json";

const schema = z.object({
    items: z
        .array(pageProductSchema)
        .min(1)
        .max(4)
        .describe("up to 4 products per call; call again for the rest"),
});

export function createWriteProductCopyTool({ workspace }: ToolDependencies) {
    return tool(
        async ({ items }: z.infer<typeof schema>) => {
            const existing = (await workspace.readJsonOrNull<PageProduct[]>(PAGE_PRODUCTS_PATH)) ?? [];

            const byAsin = new Map(existing.map((item) => [item.asin, item]));
            for (const item of items) byAsin.set(item.asin, item);

            const all = [...byAsin.values()];
            await workspace.writeJson(PAGE_PRODUCTS_PATH, all);

            return `saved copy for ${items.map((item) => item.asin).join(", ")} — ${all.length} products have copy so far`;
        },
        {
            name: "write_product_copy",
            description:
                "Save the page copy for up to 4 products at a time: an enhanced_title and 3-6 key_features each. " +
                "Call it repeatedly until every product on the shortlist has copy. Results accumulate, so a second " +
                "call does not discard the first.",
            schema,
        },
    );
}
