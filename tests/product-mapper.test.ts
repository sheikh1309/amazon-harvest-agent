import { describe, expect, it } from "vitest";
import { ProductMapper } from "../src/db/product-mapper";
import { makeProduct } from "./helpers";

describe("ProductMapper.currency", () => {
    it("maps the symbol the scrape captures to ISO 4217", () => {
        expect(ProductMapper.currency(makeProduct({ currency: "$" }))).toBe("USD");
        expect(ProductMapper.currency(makeProduct({ currency: "£" }))).toBe("GBP");
        expect(ProductMapper.currency(makeProduct({ currency: "€" }))).toBe("EUR");
        expect(ProductMapper.currency(makeProduct({ currency: "C$" }))).toBe("CAD");
    });

    it("passes an already-ISO code through", () => {
        expect(ProductMapper.currency(makeProduct({ currency: "SEK" }))).toBe("SEK");
    });

    it("defaults to USD rather than writing something the varchar(3) column cannot hold", () => {
        expect(ProductMapper.currency(makeProduct({ currency: null }))).toBe("USD");
        expect(ProductMapper.currency(makeProduct({ currency: "kr." }))).toBe("USD");
        expect(ProductMapper.currency(makeProduct({ currency: "  " }))).toBe("USD");
    });
});

describe("ProductMapper.brand", () => {
    it("unwraps the three shapes #bylineInfo renders", () => {
        expect(ProductMapper.brand(makeProduct({ brand: "Visit the Lodge Store" }))).toBe("Lodge");
        expect(ProductMapper.brand(makeProduct({ brand: "Brand: Lodge" }))).toBe("Lodge");
        expect(ProductMapper.brand(makeProduct({ brand: "Lodge" }))).toBe("Lodge");
    });

    it("returns null when the byline carries no brand at all", () => {
        expect(ProductMapper.brand(makeProduct({ brand: null }))).toBeNull();
        expect(ProductMapper.brand(makeProduct({ brand: "   " }))).toBeNull();
        expect(ProductMapper.brand(makeProduct({ brand: "Visit the Store" }))).toBeNull();
    });

    it("does not truncate a brand that merely ends in 'store'", () => {
        expect(ProductMapper.brand(makeProduct({ brand: "Bookstore" }))).toBe("Bookstore");
    });

    it("truncates to the column width", () => {
        expect(ProductMapper.brand(makeProduct({ brand: "x".repeat(400) }))).toHaveLength(255);
    });
});

describe("ProductMapper.isAvailable", () => {
    it("is false when amazon says the item cannot be had", () => {
        expect(ProductMapper.isAvailable(makeProduct({ availability: "Currently unavailable" }))).toBe(false);
        expect(ProductMapper.isAvailable(makeProduct({ availability: "Out of Stock" }))).toBe(false);
        expect(
            ProductMapper.isAvailable(
                makeProduct({ availability: "This item cannot be shipped to your selected address" }),
            ),
        ).toBe(false);
    });

    it("is false when there is no price, whatever the availability text says", () => {
        expect(ProductMapper.isAvailable(makeProduct({ price: null, availability: "In Stock" }))).toBe(false);
    });

    it("is true for a normal in-stock product", () => {
        expect(ProductMapper.isAvailable(makeProduct({ price: 24.9, availability: "In Stock" }))).toBe(true);
    });
});

describe("ProductMapper.toColumns", () => {
    const mapper = new ProductMapper();

    it("builds every column the products upsert needs", () => {
        const columns = mapper.toColumns(makeProduct(), "best10deals-20");

        expect(columns.asin).toBe("B000000001");
        expect(columns.brand).toBe("Lodge");
        expect(columns.currency).toBe("USD");
        expect(columns.affiliateUrl).toBe("https://www.amazon.com/dp/B000000001?tag=best10deals-20");
        expect(columns.imageUrl).toBe("https://m.media-amazon.com/images/I/a.jpg");
        expect(columns.isAvailable).toBe(true);
    });

    it("rounds a fractional review count for the integer column", () => {
        expect(mapper.toColumns(makeProduct({ review_count: 4.6 }), "t").reviewCount).toBe(5);
    });

    it("refuses a product with no title, because products.title is NOT NULL", () => {
        expect(() => mapper.toColumns(makeProduct({ title: null }), "t")).toThrow(/has no title/);
        expect(() => mapper.toColumns(makeProduct({ title: "   " }), "t")).toThrow(/has no title/);
    });

    it("preserves the stored specifications shape the site reads back", () => {
        const specifications = JSON.parse(mapper.toColumns(makeProduct(), "t").specifications);

        expect(Object.keys(specifications).sort()).toEqual([
            "availability",
            "coupon",
            "images",
            "is_prime",
            "list_price",
            "scraped_at",
            "source_url",
            "variants",
        ]);
    });
});
