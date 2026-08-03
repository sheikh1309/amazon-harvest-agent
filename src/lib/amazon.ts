import { config } from "./config";
import type { product } from "../schema/product";

/** amazon serves thumbnails as `<id>._SS64_.jpg`; stripping the modifier gives the original. */
export function full_res(url: string | null): string | null {
    return url ? url.replace(/\._[A-Z0-9_,\-]+_\./, ".") : null;
}

export function product_url(asin: string) {
    return `https://www.amazon.com/dp/${asin}`;
}

export function affiliate_url(asin: string) {
    return `https://www.amazon.com/dp/${asin}?tag=${config.affiliate_tag}`;
}

export function search_url(keyword: string, page: number) {
    return `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&page=${page}`;
}

export function is_asin(value: unknown): value is string {
    return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

export function to_number(text: string | null | undefined): number | null {
    if (!text) return null;
    const m = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
}

/** rating alone ranks a 5.0★/3-review item above a 4.6★/40k-review one; weight by review volume. */
export function score(p: product) {
    return (p.rating ?? 0) * Math.log10((p.review_count ?? 0) + 1);
}

/**
 * Collapse listings that are really the same product.
 *
 * `parent_asin` is exact and is tried first: sibling variants of one parent are
 * separate ASINs with separate titles but a shared review pool, so a search for
 * "cast iron skillet" happily returns the 8", 10.25" and 12" Lodge pans as three
 * results with the same 144,790 reviews. Title similarity does not catch that.
 */
export function dedup_key(p: product) {
    if (p.variants.parent_asin) return `parent:${p.variants.parent_asin}`;

    return (
        "title:" +
        (p.title ?? "")
            .toLowerCase()
            .replace(/[®™]/g, "")
            .replace(/,.*$/, "")
            .replace(/\s+/g, " ")
            .trim()
    );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const jitter = (base: number) => base + Math.random() * base;

export function slug(text: string) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
