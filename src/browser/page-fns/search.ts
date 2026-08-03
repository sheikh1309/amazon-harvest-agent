/**
 * Runs inside the page. Must stay self-contained — playwright serializes the
 * function source, so it cannot close over anything in this module.
 *
 * Pulls rating/review/price straight off the search card so callers can filter
 * before paying for a detail-page visit.
 */
export function extract_search_cards() {
    const num = (s: string | null | undefined) => {
        if (!s) return null;
        const m = s.replace(/,/g, "").match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    };

    const cards = Array.from(
        document.querySelectorAll("div[data-component-type='s-search-result']"),
    );

    // Amazon answers some bot-flagged requests with an empty 202 that has no results
    // container at all. That is a retryable failure, whereas a rendered container with
    // no cards is a genuinely empty result page — the caller has to tell them apart.
    const rendered = !!document.querySelector(
        ".s-main-slot, [data-component-type='s-search-results']",
    );

    const parsed = cards.map((card) => {
        const text = (sel: string) => card.querySelector(sel)?.textContent?.trim() || null;
        const attr = (sel: string, name: string) => card.querySelector(sel)?.getAttribute(name) || null;

        const heading = text("h2 span") || text("h2");

        // amazon marks paid placements three different ways depending on the layout
        const sponsored =
            !!card.querySelector(".puis-sponsored-label-text, [data-component-type='sp-sponsored-result']") ||
            /^sponsored/i.test(attr("h2 a", "aria-label") || "") ||
            /^sponsored ad/i.test(heading || "");

        const rating =
            num(attr("[aria-label*='out of 5 stars']", "aria-label")) ??
            num(text("i[class*='a-icon-star'] .a-icon-alt")) ??
            num(text(".a-icon-alt"));

        const review_count =
            num(attr("[aria-label$='ratings'], [aria-label$='rating']", "aria-label")) ??
            num(text("[data-csa-c-content-id='alf-customer-ratings-count-component'] span")) ??
            num(text(".s-underline-text"));

        return {
            asin: card.getAttribute("data-asin"),
            title: heading ? heading.replace(/^sponsored ad\s*-\s*/i, "") : null,
            price: num(text(".a-price .a-offscreen")),
            rating,
            review_count,
            image: attr("img.s-image", "src"),
            sponsored,
        };
    });

    return { rendered, cards: parsed };
}
