import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetch_product } from "../browser/scrape";
import { read_json, write_json } from "../lib/workspace";
import type { product } from "../schema/product";

const schema = z.object({
    asin: z.string().describe("the parent ASIN whose /products file should be enriched"),
    limit: z.number().int().min(1).max(20).default(10)
        .describe("cap on how many child variants to visit"),
});

async function run({ asin, limit }: z.infer<typeof schema>) {
    let parent: product;
    try {
        parent = await read_json<product>(`products/${asin}.json`);
    } catch {
        return `no /products/${asin}.json — scrape the parent with fetch_products first`;
    }

    // the combination that *is* this product needs no extra fetch — copy it across so
    // the matrix is uniform rather than having one conspicuously empty row
    const self = parent.variants.combinations.find((c) => c.asin === asin);
    if (self && self.title == null) {
        self.title = parent.title;
        self.price = parent.price;
        self.currency = parent.currency;
        self.image = parent.images.find((i) => i.is_primary)?.url ?? parent.images[0]?.url ?? null;
        self.availability = parent.availability;
    }

    // the parent page gives us every child ASIN and its coordinates, but the child's
    // own price, title and hero image only exist on the child's page
    const targets = parent.variants.combinations
        .filter((c) => c.asin && c.asin !== asin && c.title == null)
        .slice(0, limit);

    if (!targets.length) {
        await write_json(`products/${asin}.json`, parent);
        return `${asin}: nothing to enrich (${parent.variants.combinations.length} combinations already resolved)`;
    }

    const results = await Promise.allSettled(targets.map((c) => fetch_product(c.asin)));

    let filled = 0;
    const lines: string[] = [];

    for (let i = 0; i < results.length; i++) {
        const target = targets[i];
        const result = results[i];

        if (result.status !== "fulfilled") {
            lines.push(`✗ ${target.asin}  ${String(result.reason?.message ?? result.reason).split("\n")[0]}`);
            continue;
        }

        const child = result.value;
        const entry = parent.variants.combinations.find((c) => c.asin === target.asin);
        if (!entry) continue;

        entry.title = child.title;
        entry.price = child.price;
        entry.currency = child.currency;
        entry.image = child.images.find((img) => img.is_primary)?.url ?? child.images[0]?.url ?? null;
        entry.availability = child.availability;
        filled++;

        const coords = Object.values(entry.values).join(" / ") || target.asin;
        lines.push(`✓ ${target.asin}  ${coords}  ${entry.price != null ? `${entry.currency ?? ""}${entry.price}` : "no price"}`);
    }

    await write_json(`products/${asin}.json`, parent);

    return [`${asin}: enriched ${filled}/${targets.length} variants`, ...lines].join("\n");
}

export const fetch_variant_details = tool(run, {
    name: "fetch_variant_details",
    description:
        "Visit each child variant of an already-scraped product and fill in that variant's own title, price, hero image " +
        "and availability, writing the result back into /products/<asin>.json. Only worth calling when the parent's " +
        "variant values came back without prices — the swatch prices on the parent page are often not rendered.",
    schema,
});
