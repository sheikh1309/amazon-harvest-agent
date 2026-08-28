import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { slugify } from "../lib/text";
import type { ToolDependencies } from "./tool-dependencies";

export function createSearchAmazonTool({ config, workspace, scraper }: ToolDependencies) {
    const schema = z.object({
        keyword: z.string().describe("search phrase, e.g. 'charcoal grill'"),
        pages: z
            .number()
            .int()
            .min(1)
            .max(10)
            .default(config.maxPages)
            .describe("how many result pages to walk"),
        min_rating: z.number().default(0).describe("drop cards below this star rating; 0 keeps everything"),
        min_reviews: z.number().default(0).describe("drop cards below this review count; 0 keeps everything"),
        include_sponsored: z.boolean().default(false).describe("include paid placements; normally false"),
    });

    return tool(
        async ({ keyword, pages, min_rating, min_reviews, include_sponsored }: z.infer<typeof schema>) => {
            const discovered = await scraper.discover(keyword, {
                pages,
                includeSponsored: include_sponsored,
            });

            const kept = discovered.filter(
                (candidate) =>
                    (candidate.rating ?? 0) >= min_rating && (candidate.review_count ?? 0) >= min_reviews,
            );

            const path = `candidates/${slugify(keyword)}.json`;
            await workspace.writeJson(path, {
                keyword,
                searched_at: new Date().toISOString(),
                candidates: kept,
            });

            const listing = kept
                .slice(0, 40)
                .map(
                    (candidate) =>
                        `${candidate.asin}  ${candidate.rating ?? "-"}★ ${candidate.review_count ?? "-"} rev  ` +
                        `${candidate.title?.slice(0, 60) ?? ""}`,
                )
                .join("\n");

            return [
                `found ${discovered.length} organic cards, ${kept.length} pass the bar ` +
                    `(>=${min_rating}★, >=${min_reviews} reviews)`,
                `written to /${path}`,
                "",
                listing,
            ].join("\n");
        },
        {
            name: "search_amazon",
            description:
                "Search amazon and return candidate ASINs with the rating, review count and price shown on the results card. " +
                "Filters on those numbers before any detail page is opened, so always pass min_rating/min_reviews here rather " +
                "than fetching everything and filtering later. Writes the full card data to /candidates/<keyword>.json.",
            schema,
        },
    );
}
