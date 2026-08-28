import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";
import type { Workspace } from "../lib/workspace";
import type { BrowserPool } from "../browser/browser-pool";
import type { Database } from "../db/database";
import type { PageRepository } from "../db/page-repository";
import type { WebsiteRepository } from "../db/website-repository";
import type { HarvestAgent } from "../agent/harvest-agent";
import type { PageWriterAgent } from "../agent/page-writer-agent";
import type { RunStatus } from "../db/harvest-run-repository";
import type { RunArtifacts } from "./run-artifacts";
import type { RunContext } from "./run-context";
import type { RunRecorder } from "./run-recorder";
import type { KeywordQueue } from "./keyword-queue";
import type { ShutdownSignal } from "./shutdown-signal";
import { ExitCode } from "./exit-code";

const SEPARATOR = "-".repeat(60);

export class HarvestRunner {
    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
        private readonly context: RunContext,
        private readonly workspace: Workspace,
        private readonly browser: BrowserPool,
        private readonly database: Database,
        private readonly pages: PageRepository,
        private readonly websites: WebsiteRepository,
        private readonly harvestAgent: HarvestAgent,
        private readonly pageWriter: PageWriterAgent,
        private readonly recorder: RunRecorder,
        private readonly queue: KeywordQueue,
        private readonly artifacts: RunArtifacts,
        private readonly shutdown: ShutdownSignal,
    ) {}

    async run(): Promise<ExitCode> {
        this.logHeader();

        let error: string | null = null;
        let productsPublished = 0;

        try {
            await this.harvest();
            productsPublished = await this.publishPage();
        } catch (caught) {
            error = (caught as Error).message;
            this.logger.error(`run failed: ${error}`);
        }

        const pageIsSaved = await this.verifyPageSaved();
        const status: RunStatus = error ? "failed" : pageIsSaved ? "succeeded" : "partial";

        await this.recorder.record(this.context, { status, error, productsPublished });

        if (!pageIsSaved) await this.queue.release(this.context.keyword);

        this.logger.info(`done in ${(this.context.elapsedMs / 1000).toFixed(1)}s`, { status });

        return status === "succeeded" ? ExitCode.Ok : ExitCode.Failed;
    }

    private logHeader(): void {
        const fallbacks = this.config.fallbackModels.length
            ? ` (fallbacks: ${this.config.fallbackModels.join(", ")})`
            : "";

        this.logger.blankLine();
        this.logger.info(`run:     ${this.context.id}`);
        this.logger.info(
            `keyword: ${this.context.keywordText}${this.context.isQueuedKeyword ? "" : "  (not a keywords row)"}`,
        );
        this.logger.info(`model:   ${this.config.model}${fallbacks}`);
        this.logger.info(`browser: ${this.config.concurrency} parallel contexts`);
        this.logger.info(
            `db:      ${this.database.enabled ? this.config.siteDomain : "disabled — DATABASE_URL unset"}`,
        );
        this.logger.info(`work:    ${this.workspace.root}`);
        this.logger.blankLine();
    }

    private async harvest(): Promise<void> {
        const summary = await this.harvestAgent.run(
            this.context.keywordText,
            this.shutdown.deadline(this.config.runTimeoutMs),
            () => this.shutdown.throwIfRequested(),
        );

        this.assertPricingIsTrustworthy();

        this.logger.blankLine();
        this.logger.info(SEPARATOR);
        if (summary.trim()) this.logger.info(summary.trim());
        this.logger.info(SEPARATOR);
    }

    private assertPricingIsTrustworthy(): void {
        if (!this.config.requireUsPricing) return;

        const location = this.browser.deliveryLocation;
        if (location.isUnitedStates) return;

        throw new Error(
            `REQUIRE_US_PRICING is set but amazon resolved delivery to "${location.address ?? "unknown"}"`,
        );
    }

    private async publishPage(): Promise<number> {
        if (!this.database.enabled) {
            this.logger.info("page: skipped — DATABASE_URL is not set");
            return 0;
        }

        const outputPath = await this.recorder.outputPath(this.context);
        if (!outputPath) {
            this.logger.warn(`page: skipped — no output file for "${this.context.keywordText}"`);
            return 0;
        }

        const output = await this.workspace.readJson<{ products: { asin: string }[] }>(outputPath);
        const asins = (output.products ?? []).map((product) => product.asin).filter(Boolean);

        this.logger.blankLine();
        this.logger.info(`page: writing SEO page for ${asins.length} products`);

        try {
            const navigationCategories = await this.websites.navigationCategories().catch(() => []);
            return await this.pageWriter.write(this.context.keyword, asins, navigationCategories);
        } catch (error) {
            this.logger.error(`page: FAILED (${(error as Error).message})`);
            return 0;
        }
    }

    private async verifyPageSaved(): Promise<boolean> {
        if (!this.database.enabled) {
            this.logger.info("db: skipped — DATABASE_URL is not set");
            return true;
        }

        if (this.artifacts.pageWasCommitted) {
            this.logger.info(`db: page /${this.artifacts.pageSlug} saved`);
            return true;
        }

        if (this.context.keyword.id) {
            const existing = await this.pages
                .findSlugForKeyword(this.context.keyword.id)
                .catch(() => null);

            if (existing) {
                this.logger.info(`db: page /${existing} exists for this keyword`);
                return true;
            }
        }

        this.logger.error(
            "db: FAILED — the run finished without saving a page; keyword left unprocessed",
        );
        return false;
    }
}
