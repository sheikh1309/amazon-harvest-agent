import type { Product } from "../schema/product";

const CURRENCY_SYMBOLS: Record<string, string> = {
    $: "USD",
    "US$": "USD",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
    "₹": "INR",
    C$: "CAD",
    A$: "AUD",
};

const ISO_CURRENCY = /^[A-Z]{3}$/;
const UNAVAILABLE =
    /currently unavailable|out of stock|no longer available|cannot be shipped|unavailable/i;

export type ProductColumns = {
    asin: string;
    title: string;
    brand: string | null;
    price: number | null;
    currency: string;
    imageUrl: string | null;
    rating: number | null;
    reviewCount: number | null;
    features: string;
    specifications: string;
    description: string | null;
    affiliateUrl: string;
    isAvailable: boolean;
    lastFetchedAt: string;
};

export class ProductMapper {
    toColumns(product: Product, trackingId: string): ProductColumns {
        const title = (product.title ?? "").trim();
        if (!title) throw new Error(`${product.asin} has no title`);

        return {
            asin: product.asin.slice(0, 20),
            title,
            brand: ProductMapper.brand(product),
            price: product.price,
            currency: ProductMapper.currency(product),
            imageUrl: ProductMapper.primaryImage(product),
            rating: product.rating,
            reviewCount: product.review_count === null ? null : Math.round(product.review_count),
            features: JSON.stringify(product.features ?? []),
            specifications: JSON.stringify(ProductMapper.specifications(product)),
            description: product.description,
            affiliateUrl: `https://www.amazon.com/dp/${product.asin}?tag=${trackingId}`,
            isAvailable: ProductMapper.isAvailable(product),
            lastFetchedAt: product.scraped_at,
        };
    }

    static currency(product: Product): string {
        const raw = (product.currency ?? "").trim();
        return CURRENCY_SYMBOLS[raw] ?? (ISO_CURRENCY.test(raw) ? raw : "USD");
    }

    static brand(product: Product): string | null {
        const cleaned = (product.brand ?? "")
            .replace(/^visit the\s+/i, "")
            .replace(/\s+store$/i, "")
            .replace(/^brand:\s*/i, "")
            .trim();

        if (!cleaned || /^store$/i.test(cleaned)) return null;
        return cleaned.slice(0, 255);
    }

    static isAvailable(product: Product): boolean {
        if (product.availability && UNAVAILABLE.test(product.availability)) return false;
        return product.price !== null;
    }

    static primaryImage(product: Product): string | null {
        return product.images.find((image) => image.is_primary)?.url ?? product.images[0]?.url ?? null;
    }

    static specifications(product: Product): Record<string, unknown> {
        return {
            list_price: product.list_price,
            is_prime: product.is_prime,
            coupon: product.coupon,
            availability: product.availability,
            images: product.images.map((image) => image.url),
            variants: product.variants,
            source_url: product.url,
            scraped_at: product.scraped_at,
        };
    }
}
