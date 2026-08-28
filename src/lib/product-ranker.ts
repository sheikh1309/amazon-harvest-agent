import type { Product } from "../schema/product";

export type RankingCriteria = {
    minRating: number;
    minReviews: number;
    limit: number;
    requirePrice: boolean;
};

export type RankingResult = {
    considered: number;
    passedFilters: number;
    ranked: Product[];
};

export class ProductRanker {
    rank(products: Product[], criteria: RankingCriteria): RankingResult {
        const passed = products.filter((product) => this.meetsQualityBar(product, criteria));
        const seen = new Set<string>();

        const ranked = passed
            .slice()
            .sort((a, b) => ProductRanker.score(b) - ProductRanker.score(a))
            .filter((product) => {
                const key = ProductRanker.deduplicationKey(product);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, criteria.limit);

        return { considered: products.length, passedFilters: passed.length, ranked };
    }

    private meetsQualityBar(product: Product, criteria: RankingCriteria): boolean {
        if ((product.rating ?? 0) < criteria.minRating) return false;
        if ((product.review_count ?? 0) < criteria.minReviews) return false;
        if (criteria.requirePrice && product.price === null) return false;
        return true;
    }

    static score(product: Product): number {
        return (product.rating ?? 0) * Math.log10((product.review_count ?? 0) + 1);
    }

    static deduplicationKey(product: Product): string {
        if (product.variants.parent_asin) return `parent:${product.variants.parent_asin}`;

        const normalisedTitle = (product.title ?? "")
            .toLowerCase()
            .replace(/[®™]/g, "")
            .replace(/,.*$/, "")
            .replace(/\s+/g, " ")
            .trim();

        return `title:${normalisedTitle}`;
    }
}
