import { describe, expect, it } from "vitest";
import { DerivedPageCopy } from "../src/agent/derived-page-copy";
import { pageProductSchema } from "../src/schema/page";
import { makeProduct } from "./helpers";

describe("DerivedPageCopy", () => {
    it("always produces something the page schema accepts", () => {
        const cases = [
            makeProduct(),
            makeProduct({ features: [] }),
            makeProduct({ features: [], brand: null, rating: null, review_count: null, is_prime: false }),
            makeProduct({ title: null, features: [] }),
        ];

        for (const p of cases) {
            expect(() => pageProductSchema.parse(DerivedPageCopy.from(p))).not.toThrow();
        }
    });

    it("meets the schema's three-feature minimum by padding with facts from the scrape", () => {
        const copy = DerivedPageCopy.from(makeProduct({ features: [] }));

        expect(copy.key_features.length).toBeGreaterThanOrEqual(3);
        expect(copy.key_features).toContain("Rated 4.7 stars across 144,790 reviews");
        expect(copy.key_features).toContain("From Lodge");
    });

    it("prefers amazon's own bullets over the padding", () => {
        const copy = DerivedPageCopy.from(
            makeProduct({ features: ["Pre-seasoned with oil", "Made in South Pittsburg", "Lasts a lifetime"] }),
        );

        expect(copy.key_features.slice(0, 3)).toEqual([
            "Pre-seasoned with oil",
            "Made in South Pittsburg",
            "Lasts a lifetime",
        ]);
    });

    it("drops bullets too short to say anything", () => {
        const copy = DerivedPageCopy.from(makeProduct({ features: ["Blue", "10 inch", "Cast iron construction"] }));
        expect(copy.key_features).toContain("Cast iron construction");
        expect(copy.key_features).not.toContain("Blue");
    });

    it("falls back to the asin when the scrape has no title", () => {
        // enhanced_title is min(1) in the schema, so an empty string fails the whole page
        const copy = DerivedPageCopy.from(makeProduct({ title: null }));
        expect(copy.enhanced_title).toBe("B000000001");
    });

    it("caps the feature count at the schema's maximum", () => {
        const copy = DerivedPageCopy.from(
            makeProduct({ features: Array.from({ length: 20 }, (_, i) => `Feature number ${i}`) }),
        );
        expect(copy.key_features.length).toBeLessThanOrEqual(6);
    });

    it("collapses the whitespace amazon leaves in its bullets", () => {
        const copy = DerivedPageCopy.from(makeProduct({ features: ["  Pre-seasoned\n\n   and ready  "] }));
        expect(copy.key_features[0]).toBe("Pre-seasoned and ready");
    });
});
