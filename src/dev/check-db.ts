import "dotenv/config";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { Workspace } from "../lib/workspace";
import { Database } from "../db/database";
import { KeywordRepository } from "../db/keyword-repository";
import { WebsiteRepository } from "../db/website-repository";
import { PageRepository } from "../db/page-repository";
import { pageContentSchema } from "../schema/page";
import { slugify } from "../lib/text";
import type { Product } from "../schema/product";

const SAMPLE_SIZE = 5;

async function main(): Promise<void> {
    const config = Config.load();
    if (!config.databaseEnabled) throw new Error("DATABASE_URL is not set");

    const logger = new Logger({ runId: "check-db", format: "text", level: config.logLevel });
    const database = new Database(config, logger);
    const keywords = new KeywordRepository(database, logger);
    const websites = new WebsiteRepository(database, config.siteDomain);
    const pages = new PageRepository(database, websites);

    try {
        console.log(`db:      ${config.siteDomain}`);

        const navigation = await websites.navigationCategories();
        console.log(
            `nav:     ${navigation.length} categories — ${navigation.slice(0, 6).join(", ")}` +
                `${navigation.length > 6 ? " …" : ""}`,
        );

        const requested = process.argv.slice(2).join(" ").trim();
        const keyword = requested
            ? await keywords.claimByName(requested)
            : await keywords.claimNext(config.claimTimeoutMinutes);

        if (!keyword) throw new Error("no unclaimed keywords left to test with");
        console.log(`keyword: "${keyword.keyword}"  (id ${keyword.id}, category ${keyword.category_id})`);

        const workspace = new Workspace(config.workspaceRoot, slugify(keyword.keyword), config.outputDir);
        const asins = await workspace.scrapedAsins();
        if (!asins.length) {
            throw new Error(`no scraped products for "${keyword.keyword}" — run a harvest for it first`);
        }

        const products = new Map<string, Product>();
        for (const asin of asins.slice(0, SAMPLE_SIZE)) {
            const product = await workspace.readJsonOrNull<Product>(`products/${asin}.json`);
            if (product?.title) products.set(product.asin, product);
        }
        console.log(`sample:  ${products.size} scraped products from /products`);

        const content = pageContentSchema.parse({
            parent_category: navigation[0] ?? "General",
            page_title: "check-db dry run",
            meta_description: "A dry-run page written by check-db and rolled back.",
            h1_title: "check-db dry run",
            introduction: "This page is never committed.",
            conclusion: "This page is never committed.",
            buying_guide: {
                title: "Dry run",
                sections: [
                    { heading: "One", content: "First section." },
                    { heading: "Two", content: "Second section." },
                ],
            },
            faq: [
                { question: "Is this real?", answer: "No." },
                { question: "Was it committed?", answer: "No." },
                { question: "Did the SQL run?", answer: "Yes, then rolled back." },
            ],
            products: [...products.values()].map((product) => ({
                asin: product.asin,
                enhanced_title: (product.title ?? product.asin).slice(0, 120),
                key_features: ["dry run", "not committed", "schema check"],
            })),
        });

        const result = await pages.save(keyword, content, products, { dryRun: true });

        console.log(
            `save:    OK (rolled back) — slug ${result.slug}, ` +
                `${result.productsInserted} would insert, ${result.productsUpdated} would update`,
        );
        if (result.skipped.length) console.log(`skipped: ${result.skipped.join("; ")}`);
        console.log("\nevery statement executed against the live schema; nothing was kept.");
    } finally {
        await database.close();
    }
}

main().catch((error: Error) => {
    console.error(`\ncheck-db failed: ${error.message}`);
    process.exitCode = 1;
});
