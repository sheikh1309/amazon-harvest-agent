import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";
import type { ModelFactory } from "../lib/model-factory";
import type { Workspace } from "../lib/workspace";
import { StreamRenderer } from "../lib/stream-renderer";
import type { ToolRegistry } from "../tools/tool-registry";
import type { PageRepository } from "../db/page-repository";
import type { KeywordRow } from "../db/keyword-repository";
import type { RunArtifacts } from "../app/run-artifacts";
import { PAGE_COPY_PATH } from "../tools/write-page-copy.tool";
import { PAGE_PRODUCTS_PATH } from "../tools/write-product-copy.tool";
import type { PageCopy, PageProduct } from "../schema/page";
import type { Product } from "../schema/product";
import { DerivedPageCopy } from "./derived-page-copy";
import type { PromptLibrary } from "./prompt-library";

const RECURSION_LIMIT = 40;
const MAX_ATTEMPTS = 2;

export class PageWriterAgent {
    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
        private readonly models: ModelFactory,
        private readonly workspace: Workspace,
        private readonly tools: ToolRegistry,
        private readonly prompts: PromptLibrary,
        private readonly pages: PageRepository,
        private readonly artifacts: RunArtifacts,
    ) {}

    async write(keyword: KeywordRow, asins: string[], navigationCategories: string[]): Promise<number> {
        if (!asins.length) throw new Error("no ranked ASINs to write a page from");

        await this.workspace.removeDirectory("page");

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await this.generateCopy(keyword.keyword, asins, navigationCategories);

            const copy = await this.workspace.readJsonOrNull<PageCopy>(PAGE_COPY_PATH);
            if (!copy) {
                if (attempt < MAX_ATTEMPTS) this.logger.warn("writer: no page copy produced, retrying once");
                continue;
            }

            return this.commit(keyword, asins, copy);
        }

        throw new Error(`writer produced no page copy after ${MAX_ATTEMPTS} attempts`);
    }

    private async generateCopy(
        keyword: string,
        asins: string[],
        navigationCategories: string[],
    ): Promise<void> {
        const agent = createDeepAgent({
            model: this.models.create(),
            systemPrompt: this.prompts.pageWriter(navigationCategories),
            tools: this.tools.writerTools,
            backend: new FilesystemBackend({ rootDir: this.workspace.root, virtualMode: true }),
        });

        const stream = await agent.stream(
            { messages: [{ role: "user", content: this.prompts.pageWriterInstruction(keyword, asins) }] },
            { streamMode: "updates", recursionLimit: RECURSION_LIMIT },
        );

        const renderer = new StreamRenderer(this.logger, "    ");
        for await (const update of stream) renderer.render(update as Record<string, unknown>);
    }

    private async commit(keyword: KeywordRow, asins: string[], copy: PageCopy): Promise<number> {
        const written = (await this.workspace.readJsonOrNull<PageProduct[]>(PAGE_PRODUCTS_PATH)) ?? [];
        const writtenByAsin = new Map(written.map((item) => [item.asin, item]));

        const items: PageProduct[] = [];
        const scrapedProducts = new Map<string, Product>();
        let derivedCount = 0;

        for (const asin of asins) {
            const product = await this.workspace.readJsonOrNull<Product>(`products/${asin}.json`);
            if (!product) continue;

            scrapedProducts.set(asin, product);

            const modelCopy = writtenByAsin.get(asin);
            if (modelCopy) {
                items.push(modelCopy);
            } else {
                items.push(DerivedPageCopy.from(product));
                derivedCount++;
            }
        }

        if (!items.length) throw new Error("no scraped products matched the ranked ASINs");
        if (derivedCount) {
            this.logger.warn(`writer: ${derivedCount}/${items.length} products fell back to derived copy`);
        }

        const result = await this.pages.save(
            keyword,
            { ...copy, products: items },
            scrapedProducts,
            { dryRun: this.config.pageDryRun },
        );

        if (!result.rolledBack) this.artifacts.recordCommittedPage(result.slug, result.pageId);

        this.logger.info(
            (result.rolledBack
                ? `    page DRY RUN /${result.slug} — rolled back`
                : `    page saved /${result.slug}`) +
                ` — ${result.productsInserted} products inserted, ${result.productsUpdated} updated` +
                (result.keywordMarkedProcessed ? ", keyword marked processed" : ""),
            { slug: result.slug, published: items.length, derived: derivedCount, dryRun: result.rolledBack },
        );

        if (result.skipped.length) this.logger.warn(`    skipped: ${result.skipped.join("; ")}`);

        return items.length;
    }
}
