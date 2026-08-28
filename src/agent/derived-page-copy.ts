import { ProductMapper } from "../db/product-mapper";
import { collapseWhitespace } from "../lib/text";
import type { PageProduct } from "../schema/page";
import type { Product } from "../schema/product";

const MIN_FEATURES = 3;
const MAX_FEATURES = 6;
const MIN_BULLET_LENGTH = 8;
const MAX_BULLET_LENGTH = 160;
const MAX_TITLE_LENGTH = 200;

export class DerivedPageCopy {
    static from(product: Product): PageProduct {
        const features = (product.features ?? [])
            .map(collapseWhitespace)
            .filter((feature) => feature.length > MIN_BULLET_LENGTH)
            .slice(0, 4)
            .map((feature) => feature.slice(0, MAX_BULLET_LENGTH));

        const padding = DerivedPageCopy.paddingFacts(product);

        while (features.length < MIN_FEATURES && padding.length) features.push(padding.shift()!);
        while (features.length < MIN_FEATURES) features.push("See the product page for full details");

        return {
            asin: product.asin,
            enhanced_title: collapseWhitespace(product.title ?? product.asin).slice(0, MAX_TITLE_LENGTH),
            key_features: features.slice(0, MAX_FEATURES),
        };
    }

    private static paddingFacts(product: Product): string[] {
        const brand = ProductMapper.brand(product);

        return [
            product.rating !== null && product.review_count !== null
                ? `Rated ${product.rating} stars across ${product.review_count.toLocaleString("en-US")} reviews`
                : null,
            brand ? `From ${brand}` : null,
            product.is_prime ? "Available with Prime delivery" : null,
            product.variants.dimensions.length
                ? `Choice of ${product.variants.dimensions.map((d) => d.label ?? d.key).join(" and ")}`
                : null,
        ].filter((fact): fact is string => fact !== null);
    }
}
