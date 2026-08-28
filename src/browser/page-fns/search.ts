export function extractSearchCards() {
    const parseNumber = (text: string | null | undefined) => {
        if (!text) return null;
        const match = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
        return match ? Number.parseFloat(match[0]) : null;
    };

    const cards = Array.from(document.querySelectorAll("div[data-component-type='s-search-result']"));

    const rendered = !!document.querySelector(
        ".s-main-slot, [data-component-type='s-search-results']",
    );

    const parsed = cards.map((card) => {
        const text = (selector: string) => card.querySelector(selector)?.textContent?.trim() || null;
        const attribute = (selector: string, name: string) =>
            card.querySelector(selector)?.getAttribute(name) || null;

        const heading = text("h2 span") || text("h2");

        const sponsored =
            !!card.querySelector(
                ".puis-sponsored-label-text, [data-component-type='sp-sponsored-result']",
            ) ||
            /^sponsored/i.test(attribute("h2 a", "aria-label") || "") ||
            /^sponsored ad/i.test(heading || "");

        const rating =
            parseNumber(attribute("[aria-label*='out of 5 stars']", "aria-label")) ??
            parseNumber(text("i[class*='a-icon-star'] .a-icon-alt")) ??
            parseNumber(text(".a-icon-alt"));

        const reviewCount =
            parseNumber(attribute("[aria-label$='ratings'], [aria-label$='rating']", "aria-label")) ??
            parseNumber(text("[data-csa-c-content-id='alf-customer-ratings-count-component'] span")) ??
            parseNumber(text(".s-underline-text"));

        return {
            asin: card.getAttribute("data-asin"),
            title: heading ? heading.replace(/^sponsored ad\s*-\s*/i, "") : null,
            price: parseNumber(text(".a-price .a-offscreen")),
            rating,
            review_count: reviewCount,
            image: attribute("img.s-image", "src"),
            sponsored,
        };
    });

    return { rendered, cards: parsed };
}
