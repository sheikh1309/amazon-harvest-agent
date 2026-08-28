import { describe, expect, it } from "vitest";
import { collapseWhitespace, parseLeadingNumber, slugify } from "../src/lib/text";
import { AmazonUrls } from "../src/lib/amazon-urls";

describe("slugify", () => {
    it("builds a url-safe slug", () => {
        expect(slugify("Cast Iron Skillet")).toBe("cast-iron-skillet");
        expect(slugify("  BBQ & Grill (2026)  ")).toBe("bbq-grill-2026");
    });

    it("returns empty for input with nothing to slug, so callers can reject it", () => {
        expect(slugify("!!!")).toBe("");
    });
});

describe("parseLeadingNumber", () => {
    it("pulls the number out of amazon's rendered text", () => {
        expect(parseLeadingNumber("4.7 out of 5 stars")).toBe(4.7);
        expect(parseLeadingNumber("144,790 ratings")).toBe(144790);
        expect(parseLeadingNumber("$24.90")).toBe(24.9);
    });

    it("returns null rather than NaN when there is no number", () => {
        expect(parseLeadingNumber("Currently unavailable")).toBeNull();
        expect(parseLeadingNumber(null)).toBeNull();
        expect(parseLeadingNumber(undefined)).toBeNull();
    });
});

describe("collapseWhitespace", () => {
    it("flattens the whitespace amazon leaves in its bullets", () => {
        expect(collapseWhitespace("  Pre-seasoned\n\n   and ready  ")).toBe("Pre-seasoned and ready");
    });
});

describe("AmazonUrls", () => {
    const urls = new AmazonUrls("test-20");

    it("builds product, affiliate and search urls", () => {
        expect(urls.product("B00006JSUA")).toBe("https://www.amazon.com/dp/B00006JSUA");
        expect(urls.affiliate("B00006JSUA")).toBe("https://www.amazon.com/dp/B00006JSUA?tag=test-20");
        expect(urls.search("cast iron", 2)).toBe("https://www.amazon.com/s?k=cast%20iron&page=2");
    });

    it("accepts a real asin and rejects the near-misses search pages contain", () => {
        expect(AmazonUrls.isAsin("B00006JSUA")).toBe(true);
        expect(AmazonUrls.isAsin("b00006jsua")).toBe(false);
        expect(AmazonUrls.isAsin("B00006JSU")).toBe(false);
        expect(AmazonUrls.isAsin("")).toBe(false);
        expect(AmazonUrls.isAsin(null)).toBe(false);
    });

    it("strips the size modifier amazon puts on thumbnails", () => {
        expect(AmazonUrls.fullResolution("https://m.media-amazon.com/images/I/71abc._SS64_.jpg")).toBe(
            "https://m.media-amazon.com/images/I/71abc.jpg",
        );
        expect(AmazonUrls.fullResolution("https://m.media-amazon.com/images/I/71abc._AC_SX679_.jpg")).toBe(
            "https://m.media-amazon.com/images/I/71abc.jpg",
        );
        expect(AmazonUrls.fullResolution("https://m.media-amazon.com/images/I/71abc.jpg")).toBe(
            "https://m.media-amazon.com/images/I/71abc.jpg",
        );
        expect(AmazonUrls.fullResolution(null)).toBeNull();
    });
});
