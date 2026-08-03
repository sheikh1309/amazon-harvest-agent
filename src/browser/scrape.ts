import { visit } from "./pool";
import { extract_search_cards } from "./page-fns/search";
import { extract_product } from "./page-fns/product";
import { extract_variants } from "./page-fns/variants";
import { config } from "../lib/config";
import {
    affiliate_url,
    full_res,
    is_asin,
    jitter,
    product_url,
    search_url,
    sleep,
    to_number,
} from "../lib/amazon";
import { empty_variants, type candidate, type product, type variants } from "../schema/product";

/** One page of search results, organic and sponsored alike — filtering is the caller's job. */
export async function search_page(keyword: string, page_number: number): Promise<candidate[]> {
    return visit(search_url(keyword, page_number), async (page) => {
        await page
            .waitForSelector("div[data-component-type='s-search-result']", { timeout: 15_000 })
            .catch(() => {});

        const { rendered, cards } = await page.evaluate(extract_search_cards);

        // throw rather than return empty, so `visit` retries with backoff — a silently
        // empty page reads downstream as "this keyword has no products", which is wrong
        if (!rendered) throw new Error("search page did not render (throttled?)");

        return cards
            .filter((c) => is_asin(c.asin))
            .map((c) => ({ ...c, asin: c.asin as string, page: page_number }));
    });
}

export async function fetch_product(asin: string): Promise<product> {
    return visit(product_url(asin), async (page) => {
        await page.waitForSelector("#productTitle", { timeout: 20_000 });

        // per-swatch prices arrive after the twister hydrates; worth a short wait, not a long one
        const has_twister = await page.evaluate(
            () => !!document.querySelector("[id^='inline-twister-row-'], #twister"),
        );
        if (has_twister) {
            await page
                .waitForSelector(".dimension-slot-info .a-offscreen", { timeout: 2_000 })
                .catch(() => {});
        }

        const [detail, twister] = await Promise.all([
            page.evaluate(extract_product),
            page.evaluate(extract_variants),
        ]);

        return assemble(asin, detail, twister);
    });
}

type detail = Awaited<ReturnType<typeof extract_product>>;
type twister = Awaited<ReturnType<typeof extract_variants>>;

function assemble(asin: string, d: detail, t: twister): product {
    const currency = (d.price_text || "").match(/[^\d.,\s]+/);
    const money = (s: string | null) => (s ? parseFloat(s.replace(/[^\d.]/g, "")) || null : null);

    const urls = [
        ...(d.primary ? [{ url: full_res(d.primary)!, is_primary: true }] : []),
        ...d.alts.map((u) => ({ url: full_res(u)!, is_primary: false })),
    ];
    const seen = new Set<string>();
    const images = urls.filter((i) => i.url && !seen.has(i.url) && seen.add(i.url));

    return {
        asin,
        url: product_url(asin),
        affiliate_url: affiliate_url(asin),
        title: d.title,
        brand: d.brand,
        description: d.description,
        price: money(d.price_text),
        currency: currency ? currency[0] : null,
        list_price: money(d.list_text),
        rating: d.rating,
        review_count: d.review_count,
        availability: d.availability,
        is_prime: !!d.is_prime,
        coupon: d.coupon,
        images,
        variants: build_variants(asin, t),
        scraped_at: new Date().toISOString(),
    };
}

function build_variants(asin: string, t: twister): variants {
    if (!t.dimensions.length && !t.combinations.length) return empty_variants;

    const dimensions = t.dimensions.map((dim) => ({
        key: dim.key,
        label: dim.label,
        selected: dim.selected,
        values: dim.values.map((v) => ({
            asin: v.asin ?? "",
            label: v.label ?? null,
            image: full_res(v.thumb),
            thumb: v.thumb,
            price: v.price,
            available: v.available,
            selected: v.selected,
        })),
    }));

    // per-child title/price/image need the child's own page — fetch_variant_details fills these
    const combinations = t.combinations.map((c) => ({
        asin: c.asin,
        values: c.values,
        url: product_url(c.asin),
        affiliate_url: affiliate_url(c.asin),
        title: null,
        price: null,
        currency: null,
        image: null,
        availability: null,
    }));

    return {
        parent_asin: t.parent_asin,
        dimensions,
        combinations,
        count: combinations.length || dimensions.reduce((n, d) => n + d.values.length, 0),
    };
}

/** Walk search pages until we have enough candidates or run out of pages. */
export async function discover(
    keyword: string,
    opts: { pages?: number; include_sponsored?: boolean } = {},
): Promise<candidate[]> {
    const pages = opts.pages ?? config.max_pages;
    const found: candidate[] = [];
    const seen = new Set<string>();

    for (let p = 1; p <= pages; p++) {
        // pace successive pages; back-to-back search requests are what trips throttling
        if (p > 1) await sleep(jitter(800));

        const cards = await search_page(keyword, p);
        if (!cards.length) break;

        for (const c of cards) {
            if (!opts.include_sponsored && c.sponsored) continue;
            if (seen.has(c.asin)) continue;
            seen.add(c.asin);
            found.push(c);
        }
    }

    return found;
}

export { to_number };
