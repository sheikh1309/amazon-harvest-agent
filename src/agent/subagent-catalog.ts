import type { SubAgent } from "deepagents";
import type { ModelFactory } from "../lib/model-factory";
import type { ToolRegistry } from "../tools/tool-registry";

type SubAgentSpec = Omit<SubAgent, "model">;

export class SubagentCatalog {
    constructor(
        private readonly tools: ToolRegistry,
        private readonly models: ModelFactory,
    ) {}

    all(): SubAgent[] {
        const model = this.models.create();
        return this.specs().map((spec) => ({ ...spec, model }));
    }

    private specs(): SubAgentSpec[] {
        return [this.discovery(), this.extractor(), this.variantHunter(), this.curator(), this.qa()];
    }

    private discovery(): SubAgentSpec {
        return {
            name: "discovery",
            description:
                "Search amazon for a keyword and return candidate ASINs that already pass the quality bar. " +
                "Use this first, and once per keyword.",
            tools: [this.tools.searchAmazon],
            systemPrompt: [
                "You find candidate products on amazon.",
                "",
                "Call search_amazon once with the keyword and the caller's quality thresholds.",
                "Pass min_rating and min_reviews to the tool — filtering on the search card is the",
                "point, because it avoids opening detail pages for products that cannot qualify.",
                "",
                "If a keyword returns very few candidates, try one obvious rephrasing (for example",
                "'bbq grill' for 'grill') before giving up.",
                "",
                "Report back: the number of candidates found and the list of ASINs. Nothing else.",
            ].join("\n"),
        };
    }

    private extractor(): SubAgentSpec {
        return {
            name: "extractor",
            description:
                "Scrape full detail pages for a batch of ASINs, including all images and the full variant matrix. " +
                "Spawn several of these at once, each with a different slice of the ASIN list.",
            tools: [this.tools.fetchProducts],
            systemPrompt: [
                "You scrape amazon detail pages for the ASINs you are given.",
                "",
                "Call fetch_products with the whole batch in ONE call — it fetches them in parallel.",
                "Do not loop one ASIN at a time.",
                "",
                "The tool writes each product to /products/<asin>.json. Do not read those files back",
                "and do not repeat their contents; the orchestrator reads them through other tools.",
                "",
                "If some ASINs fail, retry just the failures once — a failure is usually a transient",
                "block, not a bad ASIN. Then report which ASINs succeeded and which are still failing.",
            ].join("\n"),
        };
    }

    private variantHunter(): SubAgentSpec {
        return {
            name: "variant-hunter",
            description:
                "Fill in per-variant prices, titles and images by visiting each child variant page. " +
                "Only worth running for products whose variants came back without prices.",
            tools: [this.tools.fetchVariantDetails],
            systemPrompt: [
                "You enrich the variant data of products that have already been scraped.",
                "",
                "For each ASIN you are given, call fetch_variant_details. The tool visits every child",
                "variant and writes the price, title and image back into the parent's product file.",
                "",
                "Variant swatches on the parent page frequently render without a price, which is",
                "exactly the gap you are closing. Report how many variants you resolved per product.",
            ].join("\n"),
        };
    }

    private curator(): SubAgentSpec {
        return {
            name: "curator",
            description:
                "Rank the scraped products, drop near-duplicates, and write the final JSON + markdown report. " +
                "Run this last, once everything has been scraped.",
            tools: [this.tools.rankProducts, this.tools.writeProducts],
            systemPrompt: [
                "You choose the final shortlist and write the output files.",
                "",
                "1. Call rank_products with the quality bar you were given. It scores by rating",
                "   weighted by review volume and removes near-duplicate titles.",
                "2. Look at the ranked list. rank_products collapses siblings of the same parent",
                "   product and near-identical titles, but it cannot catch the same item relisted",
                "   by a second seller, a multipack next to a single, or an accessory rather than",
                "   the product asked for. If you drop something, say which and why.",
                "3. Call write_products with the final ASINs in ranked order.",
                "",
                "Pass ASINs, never product data — write_products reads the records from disk.",
                "Report the output paths and anything you dropped.",
            ].join("\n"),
        };
    }

    private qa(): SubAgentSpec {
        return {
            name: "qa",
            description:
                "Check the finished output for missing fields and re-scrape anything that came back empty. " +
                "Run after the curator.",
            tools: [this.tools.fetchProducts, this.tools.writeProducts],
            systemPrompt: [
                "You verify the finished output.",
                "",
                "Read the output JSON you are pointed at and check each product for: a title, a",
                "rating, at least one image, and a working-looking affiliate_url.",
                "",
                "A null price is NOT automatically a defect — when `availability` says the item",
                "cannot be shipped to the configured delivery address there is genuinely no price",
                "on the page. Report that as a note, not a failure.",
                "",
                "If a product is missing a title or images, re-scrape it with fetch_products and",
                "then call write_products again with the same keyword and ASIN order.",
                "",
                "Report what you checked and what you fixed. If everything is clean, say so plainly.",
            ].join("\n"),
        };
    }
}
