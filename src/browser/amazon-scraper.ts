import type { PageNavigator } from "./page-navigator";
import { extractSearchCards } from "./page-fns/search";
import { extractProduct } from "./page-fns/product";
import { extractVariants } from "./page-fns/variants";
import { AmazonUrls } from "../lib/amazon-urls";
import { jitter, sleep } from "../lib/text";
import { EMPTY_VARIANTS, type Candidate, type Product, type ProductVariants } from "../schema/product";

type ProductDetail = Awaited<ReturnType<typeof extractProduct>>;
type TwisterData = Awaited<ReturnType<typeof extractVariants>>;

export type DiscoverOptions = {
    pages: number;
    includeSponsored: boolean;
};

const SEARCH_PAGE_DELAY_MS = 800;

export class SearchPageNotRenderedError extends Error {
    constructor() {
        super("search page did not render (throttled?)");
        this.name = "SearchPageNotRenderedError";
    }
}

export class AmazonScraper {
    constructor(
        private readonly navigator: PageNavigator,
        private readonly urls: AmazonUrls,
    ) {}

    async searchPage(keyword: string, pageNumber: number): Promise<Candidate[]> {
        return this.navigator.visit(this.urls.search(keyword, pageNumber), async (page) => {
            await page
                .waitForSelector("div[data-component-type='s-search-result']", { timeout: 15_000 })
                .catch(() => {});

            const { rendered, cards } = await page.evaluate(extractSearchCards);
            if (!rendered) throw new SearchPageNotRenderedError();

            return cards
                .filter((card) => AmazonUrls.isAsin(card.asin))
                .map((card) => ({ ...card, asin: card.asin as string, page: pageNumber }));
        });
    }

    async discover(keyword: string, options: DiscoverOptions): Promise<Candidate[]> {
        const found: Candidate[] = [];
        const seen = new Set<string>();

        for (let pageNumber = 1; pageNumber <= options.pages; pageNumber++) {
            if (pageNumber > 1) await sleep(jitter(SEARCH_PAGE_DELAY_MS));

            const cards = await this.searchPage(keyword, pageNumber);
            if (!cards.length) break;

            for (const card of cards) {
                if (!options.includeSponsored && card.sponsored) continue;
                if (seen.has(card.asin)) continue;
                seen.add(card.asin);
                found.push(card);
            }
        }

        return found;
    }

    async fetchProduct(asin: string): Promise<Product> {
        return this.navigator.visit(this.urls.product(asin), async (page) => {
            await page.waitForSelector("#productTitle", { timeout: 20_000 });

            const hasTwister = await page.evaluate(
                () => !!document.querySelector("[id^='inline-twister-row-'], #twister"),
            );
            if (hasTwister) {
                await page
                    .waitForSelector(".dimension-slot-info .a-offscreen", { timeout: 2_000 })
                    .catch(() => {});
            }

            const [detail, twister] = await Promise.all([
                page.evaluate(extractProduct),
                page.evaluate(extractVariants),
            ]);

            return this.assemble(asin, detail, twister);
        });
    }

    private assemble(asin: string, detail: ProductDetail, twister: TwisterData): Product {
        const currencyMatch = (detail.priceText || "").match(/[^\d.,\s]+/);

        return {
            asin,
            url: this.urls.product(asin),
            affiliate_url: this.urls.affiliate(asin),
            title: detail.title,
            brand: detail.brand,
            description: detail.description,
            features: detail.bullets,
            price: AmazonScraper.parseMoney(detail.priceText),
            currency: currencyMatch ? currencyMatch[0] : null,
            list_price: AmazonScraper.parseMoney(detail.listPriceText),
            rating: detail.rating,
            review_count: detail.reviewCount,
            availability: detail.availability,
            is_prime: !!detail.isPrime,
            coupon: detail.coupon,
            images: AmazonScraper.collectImages(detail),
            variants: this.buildVariants(twister),
            scraped_at: new Date().toISOString(),
        };
    }

    private buildVariants(twister: TwisterData): ProductVariants {
        if (!twister.dimensions.length && !twister.combinations.length) return EMPTY_VARIANTS;

        const dimensions = twister.dimensions.map((dimension) => ({
            key: dimension.key,
            label: dimension.label,
            selected: dimension.selected,
            values: dimension.values.map((value) => ({
                asin: value.asin ?? "",
                label: value.label ?? null,
                image: AmazonUrls.fullResolution(value.thumb),
                thumb: value.thumb,
                price: value.price,
                available: value.available,
                selected: value.selected,
            })),
        }));

        const combinations = twister.combinations.map((combination) => ({
            asin: combination.asin,
            values: combination.values,
            url: this.urls.product(combination.asin),
            affiliate_url: this.urls.affiliate(combination.asin),
            title: null,
            price: null,
            currency: null,
            image: null,
            availability: null,
        }));

        return {
            parent_asin: twister.parentAsin,
            dimensions,
            combinations,
            count:
                combinations.length ||
                dimensions.reduce((total, dimension) => total + dimension.values.length, 0),
        };
    }

    private static collectImages(detail: ProductDetail) {
        const candidates = [
            ...(detail.primaryImage ? [{ url: AmazonUrls.fullResolution(detail.primaryImage)!, is_primary: true }] : []),
            ...detail.alternateImages.map((url) => ({
                url: AmazonUrls.fullResolution(url)!,
                is_primary: false,
            })),
        ];

        const seen = new Set<string>();
        return candidates.filter((image) => image.url && !seen.has(image.url) && seen.add(image.url));
    }

    private static parseMoney(text: string | null): number | null {
        if (!text) return null;
        return Number.parseFloat(text.replace(/[^\d.]/g, "")) || null;
    }
}
