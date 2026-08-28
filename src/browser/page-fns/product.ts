export function extractProduct() {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() || null;
    const parseNumber = (value: string | null) => {
        if (!value) return null;
        const match = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
        return match ? Number.parseFloat(match[0]) : null;
    };

    const bullets = Array.from(document.querySelectorAll("#feature-bullets li span.a-list-item"))
        .map((element) => element.textContent?.trim() || "")
        .filter(Boolean);

    let gallery: Record<string, number[]> = {};
    try {
        gallery = JSON.parse(
            document.querySelector("#landingImage")?.getAttribute("data-a-dynamic-image") || "{}",
        );
    } catch {
        gallery = {};
    }

    const primaryImage =
        Object.keys(gallery).sort((a, b) => (gallery[b]?.[0] || 0) - (gallery[a]?.[0] || 0))[0] ||
        document.querySelector("#landingImage")?.getAttribute("src") ||
        null;

    const alternateImages = Array.from(document.querySelectorAll("#altImages img"))
        .map((image) => image.getAttribute("src"))
        .filter(
            (source): source is string =>
                !!source && !/play-button|sprite|transparent-pixel|360_icon/i.test(source),
        );

    const priceText =
        text("#corePrice_feature_div .a-price .a-offscreen") ||
        text("#corePrice_desktop .a-price .a-offscreen") ||
        text("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen") ||
        text("#unifiedPrice_feature_div .a-price .a-offscreen") ||
        text("#apex_desktop .a-price .a-offscreen") ||
        text("#price_inside_buybox") ||
        text("#priceblock_ourprice") ||
        text("#priceblock_dealprice") ||
        text("#centerCol .a-price .a-offscreen");

    const availability =
        (document.querySelector("#availability") as HTMLElement | null)?.innerText?.trim() ||
        (document.querySelector("#buybox, #desktop_buybox") as HTMLElement | null)?.innerText
            ?.trim()
            .split("\n")[0] ||
        null;

    return {
        title: text("#productTitle"),
        brand: text("#bylineInfo"),
        bullets,
        description: bullets.join(" ") || null,
        priceText,
        listPriceText:
            text("#centerCol .basisPrice .a-offscreen") ||
            text("#centerCol span[data-a-strike='true'] .a-offscreen"),
        rating:
            parseNumber(document.querySelector("#acrPopover")?.getAttribute("title") || null) ??
            parseNumber(text("#acrPopover .a-icon-alt")) ??
            parseNumber(text("[data-hook='rating-out-of-text']")),
        reviewCount: parseNumber(text("#acrCustomerReviewText")),
        availability,
        isPrime: !!document.querySelector("#isPrimeBadge, .a-icon-prime"),
        coupon:
            text("#couponBadgeRegularVpc") ||
            text("#promoPriceBlockMessage_feature_div") ||
            text(".couponLabelText"),
        primaryImage,
        alternateImages,
    };
}
