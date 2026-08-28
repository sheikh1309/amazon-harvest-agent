import "dotenv/config";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { Workspace } from "../lib/workspace";
import { ModelFactory } from "../lib/model-factory";
import { UsageTracker } from "../lib/usage-tracker";
import { ProductRanker } from "../lib/product-ranker";
import { AmazonUrls } from "../lib/amazon-urls";
import { slugify } from "../lib/text";
import { BrowserPool } from "../browser/browser-pool";
import { PageNavigator } from "../browser/page-navigator";
import { AmazonScraper } from "../browser/amazon-scraper";
import { Database } from "../db/database";
import { KeywordRepository } from "../db/keyword-repository";
import { WebsiteRepository } from "../db/website-repository";
import { PageRepository } from "../db/page-repository";
import { ToolRegistry } from "../tools/tool-registry";
import { PromptLibrary } from "../agent/prompt-library";
import { PageWriterAgent } from "../agent/page-writer-agent";
import { RunArtifacts } from "../app/run-artifacts";

async function main(): Promise<void> {
    const requested = process.argv.slice(2).join(" ").trim();
    if (!requested) throw new Error('usage: pnpm run check:writer "<keyword>"');

    const config = Config.load();
    if (!config.databaseEnabled) throw new Error("DATABASE_URL is not set");

    const logger = new Logger({ runId: "check-writer", format: config.logFormat, level: config.logLevel });
    const database = new Database(config, logger);
    const keywords = new KeywordRepository(database, logger);
    const websites = new WebsiteRepository(database, config.siteDomain);
    const pages = new PageRepository(database, websites);
    const usage = new UsageTracker(config.tokenBudget);
    const browser = new BrowserPool(config, logger);

    try {
        const keyword = await keywords.claimByName(requested);
        if (!keyword) throw new Error(`no keywords row for "${requested}"`);

        const workspace = new Workspace(config.workspaceRoot, slugify(keyword.keyword), config.outputDir);
        const outputPath = await workspace.newestOutput(slugify(keyword.keyword));
        if (!outputPath) {
            throw new Error(`no output file in the workspace for "${requested}" — run a harvest first`);
        }

        const output = await workspace.readJson<{ products: { asin: string }[] }>(outputPath);
        const asins = (output.products ?? []).map((product) => product.asin).filter(Boolean);

        console.log(`keyword: "${keyword.keyword}"${keyword.id ? "" : "  (not a keywords row)"}`);
        console.log(`output:  ${outputPath} — ${asins.length} products`);
        console.log(`mode:    ${config.pageDryRun ? "DRY RUN (rolled back)" : "LIVE (will write)"}\n`);

        const artifacts = new RunArtifacts();
        const tools = new ToolRegistry({
            config,
            workspace,
            scraper: new AmazonScraper(
                new PageNavigator(browser),
                new AmazonUrls(config.affiliateTag),
            ),
            ranker: new ProductRanker(),
            artifacts,
        });

        const writer = new PageWriterAgent(
            config,
            logger,
            new ModelFactory(config, usage),
            workspace,
            tools,
            new PromptLibrary(config),
            pages,
            artifacts,
        );

        await writer.write(keyword, asins, await websites.navigationCategories());
        console.log("\nwriter finished");
    } finally {
        await Promise.allSettled([browser.close(), database.close()]);
    }
}

main().catch((error: Error) => {
    console.error(`\ncheck-writer failed: ${error.message}`);
    process.exitCode = 1;
});
