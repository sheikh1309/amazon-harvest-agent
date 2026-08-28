import "dotenv/config";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { AmazonUrls } from "../lib/amazon-urls";
import { BrowserPool } from "../browser/browser-pool";
import { PageNavigator } from "../browser/page-navigator";
import { AmazonScraper } from "../browser/amazon-scraper";

const MULTI_DIMENSION_ASIN = "B09B8V1LZ3";

function report(label: string, passed: boolean, detail: string): boolean {
    console.log(`  ${passed ? "✓" : "✗"} ${label.padEnd(16)} ${detail}`);
    return passed;
}

async function main(): Promise<number> {
    const config = Config.load();
    const logger = new Logger({ runId: "check", format: "text", level: config.logLevel });
    const pool = new BrowserPool(config, logger);
    const scraper = new AmazonScraper(new PageNavigator(pool), new AmazonUrls(config.affiliateTag));

    const keyword = process.argv[2] ?? "grill";
    let failures = 0;
    const check = (passed: boolean) => {
        if (!passed) failures++;
    };

    try {
        console.log(`\nsearch: "${keyword}"`);
        const candidates = await scraper.discover(keyword, { pages: 1, includeSponsored: false });

        check(report("cards", candidates.length > 0, `${candidates.length} organic`));
        check(
            report(
                "titles",
                candidates.some((candidate) => candidate.title),
                `${candidates.filter((candidate) => candidate.title).length} with title`,
            ),
        );
        check(
            report(
                "ratings",
                candidates.some((candidate) => candidate.rating),
                `${candidates.filter((candidate) => candidate.rating).length} with rating`,
            ),
        );
        check(
            report(
                "reviews",
                candidates.some((candidate) => candidate.review_count),
                `${candidates.filter((candidate) => candidate.review_count).length} with reviews`,
            ),
        );
        check(
            report(
                "prices",
                candidates.some((candidate) => candidate.price),
                `${candidates.filter((candidate) => candidate.price).length} with price`,
            ),
        );

        if (!candidates.length) return failures;

        for (const asin of [candidates[0].asin, MULTI_DIMENSION_ASIN]) {
            console.log(`\ndetail: ${asin}`);

            try {
                const product = await scraper.fetchProduct(asin);

                check(report("title", !!product.title, product.title?.slice(0, 50) ?? "—"));
                check(
                    report(
                        "price",
                        product.price !== null || !!product.availability,
                        product.price !== null
                            ? `${product.currency ?? ""}${product.price}`
                            : `— (${product.availability?.slice(0, 45) ?? "no availability text"})`,
                    ),
                );
                check(
                    report(
                        "rating",
                        product.rating !== null,
                        `${product.rating ?? "—"}★ / ${product.review_count ?? "—"} reviews`,
                    ),
                );
                check(report("images", product.images.length > 0, `${product.images.length} images`));
                check(
                    report(
                        "description",
                        !!product.description,
                        `${product.description?.length ?? 0} chars`,
                    ),
                );

                const { dimensions, combinations } = product.variants;
                check(
                    report(
                        "variants",
                        dimensions.length > 0 || combinations.length > 0,
                        `${dimensions.length} dimensions, ${combinations.length} combinations`,
                    ),
                );

                for (const dimension of dimensions) {
                    console.log(
                        `      ${dimension.key} (${dimension.label ?? "—"}) = ${dimension.selected ?? "—"} → ` +
                            dimension.values
                                .map((value) => value.label ?? "?")
                                .slice(0, 6)
                                .join(", "),
                    );
                }

                const values = dimensions.flatMap((dimension) => dimension.values);
                check(
                    report(
                        "variant labels",
                        values.every((value) => value.label),
                        `${values.filter((value) => value.label).length} labelled`,
                    ),
                );
                report(
                    "variant images",
                    values.some((value) => value.image),
                    `${values.filter((value) => value.image).length} with image`,
                );
                report(
                    "variant prices",
                    values.some((value) => value.price !== null),
                    `${values.filter((value) => value.price !== null).length} with price`,
                );
            } catch (error) {
                check(report("scrape", false, (error as Error).message.split("\n")[0]));
            }
        }

        return failures;
    } finally {
        await pool.close();
    }
}

main()
    .then((failures) => {
        console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
        process.exitCode = failures ? 1 : 0;
    })
    .catch((error: Error) => {
        console.error(error);
        process.exitCode = 1;
    });
