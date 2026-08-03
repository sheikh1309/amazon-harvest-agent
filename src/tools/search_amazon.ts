import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { discover } from "../browser/scrape";
import { write_json } from "../lib/workspace";
import { config } from "../lib/config";
import { slug } from "../lib/amazon";

const schema = z.object({
    keyword: z.string().describe("search phrase, e.g. 'charcoal grill'"),
    pages: z.number().int().min(1).max(10).default(config.max_pages)
        .describe("how many result pages to walk"),
    min_rating: z.number().default(0)
        .describe("drop cards below this star rating; 0 keeps everything"),
    min_reviews: z.number().default(0)
        .describe("drop cards below this review count; 0 keeps everything"),
    include_sponsored: z.boolean().default(false)
        .describe("include paid placements; normally false"),
});

async function run(input: z.infer<typeof schema>) {
    const { keyword, pages, min_rating, min_reviews, include_sponsored } = input;

    const all = await discover(keyword, { pages, include_sponsored });

    // Pre-filtering here is the whole point of this tool: a search card already
    // carries rating, review count and price, so anything that fails the bar can be
    // dropped before we pay for a detail-page visit.
    const kept = all.filter(
        (c) => (c.rating ?? 0) >= min_rating && (c.review_count ?? 0) >= min_reviews,
    );

    const path = `candidates/${slug(keyword)}.json`;
    await write_json(path, { keyword, searched_at: new Date().toISOString(), candidates: kept });

    const lines = kept
        .slice(0, 40)
        .map((c) => `${c.asin}  ${c.rating ?? "-"}★ ${c.review_count ?? "-"} rev  ${c.title?.slice(0, 60) ?? ""}`)
        .join("\n");

    return [
        `found ${all.length} organic cards, ${kept.length} pass the bar (>=${min_rating}★, >=${min_reviews} reviews)`,
        `written to /${path}`,
        "",
        lines,
    ].join("\n");
}

export const search_amazon = tool(run, {
    name: "search_amazon",
    description:
        "Search amazon and return candidate ASINs with the rating, review count and price shown on the results card. " +
        "Filters on those numbers before any detail page is opened, so always pass min_rating/min_reviews here rather " +
        "than fetching everything and filtering later. Writes the full card data to /candidates/<keyword>.json.",
    schema,
});
