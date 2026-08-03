/**
 * Runs inside the page. Must stay self-contained — see the note in search.ts.
 *
 * Returns raw strings; parsing into numbers/currency happens on the node side so
 * the page function stays easy to eyeball against the live DOM.
 */
export function extract_product() {
    const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() || null;
    const num = (s: string | null) => {
        if (!s) return null;
        const m = s.replace(/,/g, "").match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    };

    const bullets = Array.from(document.querySelectorAll("#feature-bullets li span.a-list-item"))
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean);

    // the gallery map is keyed by url and valued by [width, height]; biggest wins
    let gallery: Record<string, number[]> = {};
    try {
        gallery = JSON.parse(
            document.querySelector("#landingImage")?.getAttribute("data-a-dynamic-image") || "{}",
        );
    } catch {
        gallery = {};
    }

    const primary =
        Object.keys(gallery).sort((a, b) => (gallery[b]?.[0] || 0) - (gallery[a]?.[0] || 0))[0] ||
        document.querySelector("#landingImage")?.getAttribute("src") ||
        null;

    const alts = Array.from(document.querySelectorAll("#altImages img"))
        .map((img) => img.getAttribute("src"))
        .filter((src): src is string => !!src && !/play-button|sprite|transparent-pixel|360_icon/i.test(src));

    // Amazon rotates the price container id per layout experiment, so we try several.
    //
    // Every selector here is scoped to the buybox or #centerCol on purpose. A bare
    // `.a-price .a-offscreen` also matches the sponsored carousels and "compare with
    // similar items" table, so on a page with no buybox price (out of stock, or not
    // shippable to the resolved address) it silently returns *another product's*
    // price — a wrong number is far worse than a null.
    const price_text =
        text("#corePrice_feature_div .a-price .a-offscreen") ||
        text("#corePrice_desktop .a-price .a-offscreen") ||
        text("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen") ||
        text("#unifiedPrice_feature_div .a-price .a-offscreen") ||
        text("#apex_desktop .a-price .a-offscreen") ||
        text("#price_inside_buybox") ||
        text("#priceblock_ourprice") ||
        text("#priceblock_dealprice") ||
        text("#centerCol .a-price .a-offscreen");

    // #availability also contains inline <script>, so textContent would return code
    const availability =
        (document.querySelector("#availability") as HTMLElement | null)?.innerText?.trim() ||
        // when an item can't ship to the resolved address there is no price at all —
        // record why, so a null price isn't mistaken for a scrape failure
        (document.querySelector("#buybox, #desktop_buybox") as HTMLElement | null)
            ?.innerText?.trim()
            .split("\n")[0] ||
        null;

    return {
        title: text("#productTitle"),
        brand: text("#bylineInfo"),
        description: bullets.join(" ") || null,
        price_text,
        list_text:
            text("#centerCol .basisPrice .a-offscreen") ||
            text("#centerCol span[data-a-strike='true'] .a-offscreen"),
        rating:
            num(document.querySelector("#acrPopover")?.getAttribute("title") || null) ??
            num(text("#acrPopover .a-icon-alt")) ??
            num(text("[data-hook='rating-out-of-text']")),
        review_count: num(text("#acrCustomerReviewText")),
        availability,
        is_prime: !!document.querySelector("#isPrimeBadge, .a-icon-prime"),
        coupon:
            text("#couponBadgeRegularVpc") ||
            text("#promoPriceBlockMessage_feature_div") ||
            text(".couponLabelText"),
        primary,
        alts,
    };
}
