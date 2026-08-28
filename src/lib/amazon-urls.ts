export class AmazonUrls {
    private static readonly ASIN_PATTERN = /^[A-Z0-9]{10}$/;
    private static readonly IMAGE_SIZE_MODIFIER = /\._[A-Z0-9_,\-]+_\./;

    constructor(private readonly affiliateTag: string) {}

    product(asin: string): string {
        return `https://www.amazon.com/dp/${asin}`;
    }

    affiliate(asin: string): string {
        return `https://www.amazon.com/dp/${asin}?tag=${this.affiliateTag}`;
    }

    search(keyword: string, page: number): string {
        return `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&page=${page}`;
    }

    static isAsin(value: unknown): value is string {
        return typeof value === "string" && AmazonUrls.ASIN_PATTERN.test(value);
    }

    static fullResolution(url: string | null): string | null {
        return url ? url.replace(AmazonUrls.IMAGE_SIZE_MODIFIER, ".") : null;
    }
}
