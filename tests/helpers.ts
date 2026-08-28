import { EMPTY_VARIANTS, type Product } from "../src/schema/product";

export function makeProduct(overrides: Partial<Product> = {}): Product {
    return {
        asin: "B000000001",
        url: "https://www.amazon.com/dp/B000000001",
        affiliate_url: "https://www.amazon.com/dp/B000000001?tag=test-20",
        title: "Lodge 10.25 Inch Cast Iron Skillet",
        brand: "Lodge",
        description: "Pre-seasoned cast iron skillet.",
        features: ["Pre-seasoned and ready to use", "Made in the USA"],
        price: 24.9,
        currency: "$",
        list_price: 34.9,
        rating: 4.7,
        review_count: 144_790,
        availability: "In Stock",
        is_prime: true,
        coupon: null,
        images: [
            { url: "https://m.media-amazon.com/images/I/a.jpg", is_primary: true },
            { url: "https://m.media-amazon.com/images/I/b.jpg", is_primary: false },
        ],
        variants: EMPTY_VARIANTS,
        scraped_at: "2026-08-28T00:00:00.000Z",
        ...overrides,
    };
}
