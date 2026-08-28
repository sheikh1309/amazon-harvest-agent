import { describe, expect, it } from "vitest";
import { ProductRanker } from "../src/lib/product-ranker";
import { makeProduct } from "./helpers";

const ranker = new ProductRanker();

const criteria = { minRating: 4, minReviews: 100, limit: 10, requirePrice: false };

describe("ProductRanker.score", () => {
    it("ranks a well-reviewed 4.6 above a 5.0 with three reviews", () => {
        const established = makeProduct({ rating: 4.6, review_count: 40_000 });
        const suspicious = makeProduct({ rating: 5.0, review_count: 3 });

        expect(ProductRanker.score(established)).toBeGreaterThan(ProductRanker.score(suspicious));
    });

    it("treats a missing rating or review count as zero rather than NaN", () => {
        expect(ProductRanker.score(makeProduct({ rating: null }))).toBe(0);
        expect(ProductRanker.score(makeProduct({ review_count: null }))).toBe(0);
    });
});

describe("ProductRanker.deduplicationKey", () => {
    it("collapses siblings of the same parent, whatever their titles say", () => {
        const parentVariants = { ...makeProduct().variants, parent_asin: "B0000CF3RS" };
        const eightInch = makeProduct({ asin: "B00006JSUA", title: 'Lodge 8" Skillet', variants: parentVariants });
        const twelveInch = makeProduct({ asin: "B00006JSUB", title: 'Lodge 12" Skillet', variants: parentVariants });

        expect(ProductRanker.deduplicationKey(eightInch)).toBe(ProductRanker.deduplicationKey(twelveInch));
    });

    it("falls back to a normalised title when there is no parent", () => {
        const first = makeProduct({ title: "Lodge Cast Iron Skillet®, Pre-Seasoned, 10.25 Inch" });
        const second = makeProduct({ title: "Lodge Cast Iron Skillet™,  12 Inch" });

        expect(ProductRanker.deduplicationKey(first)).toBe(ProductRanker.deduplicationKey(second));
    });

    it("keeps genuinely different products apart", () => {
        expect(ProductRanker.deduplicationKey(makeProduct({ title: "Lodge Cast Iron Skillet" }))).not.toBe(
            ProductRanker.deduplicationKey(makeProduct({ title: "Le Creuset Enamelled Dutch Oven" })),
        );
    });
});

describe("ProductRanker.rank", () => {
    it("drops products below the quality bar", () => {
        const result = ranker.rank(
            [
                makeProduct({ asin: "A", rating: 4.8, review_count: 5_000 }),
                makeProduct({ asin: "B", rating: 3.1, review_count: 5_000, title: "Low rated" }),
                makeProduct({ asin: "C", rating: 4.9, review_count: 12, title: "Barely reviewed" }),
            ],
            criteria,
        );

        expect(result.considered).toBe(3);
        expect(result.passedFilters).toBe(1);
        expect(result.ranked.map((product) => product.asin)).toEqual(["A"]);
    });

    it("keeps priceless products unless requirePrice is set", () => {
        const products = [makeProduct({ price: null, title: "Unbuyable here" })];

        expect(ranker.rank(products, criteria).ranked).toHaveLength(1);
        expect(ranker.rank(products, { ...criteria, requirePrice: true }).ranked).toHaveLength(0);
    });

    it("honours the limit and orders by score", () => {
        const result = ranker.rank(
            [
                makeProduct({ asin: "A", title: "Low", rating: 4.1, review_count: 200 }),
                makeProduct({ asin: "B", title: "High", rating: 4.9, review_count: 90_000 }),
                makeProduct({ asin: "C", title: "Mid", rating: 4.5, review_count: 4_000 }),
            ],
            { ...criteria, limit: 2 },
        );

        expect(result.ranked.map((product) => product.asin)).toEqual(["B", "C"]);
    });
});
