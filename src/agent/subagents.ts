import type { SubAgent } from "deepagents";
import { config } from "../lib/config";
import { search_amazon } from "../tools/search_amazon";
import { fetch_products } from "../tools/fetch_products";
import { fetch_variant_details } from "../tools/fetch_variant_details";
import { rank_products } from "../tools/rank_products";
import { write_products } from "../tools/write_products";

/**
 * Subagents exist for context economy as much as for division of labour.
 *
 * One product record with eight images and a dozen variants is a few KB of JSON;
 * thirty of them will not fit alongside a working conversation. Each subagent
 * writes its payload to the workspace and reports back a line per item, so the
 * orchestrator reasons over summaries while the data lives on disk.
 *
 * Subagents inherit the filesystem tools (read_file/write_file/ls/glob/grep) from
 * the main agent's middleware; the `tools` listed here are what they get on top.
 */

const discovery: SubAgent = {
    name: "discovery",
    description:
        "Search amazon for a keyword and return candidate ASINs that already pass the quality bar. " +
        "Use this first, and once per keyword.",
    model: config.fast_model,
    tools: [search_amazon],
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

const extractor: SubAgent = {
    name: "extractor",
    description:
        "Scrape full detail pages for a batch of ASINs, including all images and the full variant matrix. " +
        "Spawn several of these at once, each with a different slice of the ASIN list.",
    model: config.fast_model,
    tools: [fetch_products],
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

const variant_hunter: SubAgent = {
    name: "variant-hunter",
    description:
        "Fill in per-variant prices, titles and images by visiting each child variant page. " +
        "Only worth running for products whose variants came back without prices.",
    model: config.fast_model,
    tools: [fetch_variant_details],
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

const curator: SubAgent = {
    name: "curator",
    description:
        "Rank the scraped products, drop near-duplicates, and write the final JSON + markdown report. " +
        "Run this last, once everything has been scraped.",
    model: config.model,
    tools: [rank_products, write_products],
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

const qa: SubAgent = {
    name: "qa",
    description:
        "Check the finished output for missing fields and re-scrape anything that came back empty. " +
        "Run after the curator.",
    model: config.fast_model,
    tools: [fetch_products, write_products],
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

export const subagents = [discovery, extractor, variant_hunter, curator, qa];
