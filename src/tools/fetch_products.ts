import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { fetch_product } from "../browser/scrape";
import { write_json } from "../lib/workspace";
import type { product } from "../schema/product";

const schema = z.object({
    asins: z.array(z.string()).min(1).max(25)
        .describe("ASINs to scrape; they are fetched concurrently, so pass a batch rather than one at a time"),
});

function summarise(p: product) {
    const v = p.variants;
    const variant_note = v.dimensions.length
        ? `  variants: ${v.dimensions.map((d) => `${d.key}×${d.values.length}`).join(" ")}`
        : "";
    return (
        `✓ ${p.asin}  ${p.rating ?? "-"}★ ${p.review_count ?? "-"} rev  ` +
        `${p.price != null ? `${p.currency ?? ""}${p.price}` : "no price"}  ` +
        `${p.images.length} imgs${variant_note}  ${p.title?.slice(0, 45) ?? ""}`
    );
}

async function run({ asins }: z.infer<typeof schema>) {
    // One tool call fans out across the whole batch. The browser pool caps real
    // parallelism, so this is safe to call with 25 ASINs — it will not open 25 tabs.
    const results = await Promise.allSettled(asins.map((asin) => fetch_product(asin)));

    const lines: string[] = [];
    let ok = 0;

    for (let i = 0; i < results.length; i++) {
        const asin = asins[i];
        const result = results[i];

        if (result.status === "fulfilled") {
            await write_json(`products/${asin}.json`, result.value);
            lines.push(summarise(result.value));
            ok++;
        } else {
            lines.push(`✗ ${asin}  ${String(result.reason?.message ?? result.reason).split("\n")[0]}`);
        }
    }

    return [
        `${ok}/${asins.length} scraped, each written to /products/<asin>.json`,
        "",
        ...lines,
    ].join("\n");
}

export const fetch_products = tool(run, {
    name: "fetch_products",
    description:
        "Scrape full detail pages for a batch of ASINs: title, brand, bullets, price, rating, reviews, availability, " +
        "all gallery images, and the complete variant matrix (every dimension such as colour/size/style, each value's " +
        "swatch image, text label and price, plus every child ASIN). Writes one file per product to /products/<asin>.json " +
        "and returns only a one-line summary each, so the full payload never enters the conversation. " +
        "Always send ASINs in batches — they are fetched in parallel.",
    schema,
});
