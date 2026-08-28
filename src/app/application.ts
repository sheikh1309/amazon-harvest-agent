import { randomUUID } from "node:crypto";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { Workspace } from "../lib/workspace";
import { AmazonUrls } from "../lib/amazon-urls";
import { ProductRanker } from "../lib/product-ranker";
import { UsageTracker } from "../lib/usage-tracker";
import { ModelFactory } from "../lib/model-factory";
import { BrowserPool } from "../browser/browser-pool";
import { PageNavigator } from "../browser/page-navigator";
import { AmazonScraper } from "../browser/amazon-scraper";
import { Database } from "../db/database";
import { KeywordRepository } from "../db/keyword-repository";
import { WebsiteRepository } from "../db/website-repository";
import { PageRepository } from "../db/page-repository";
import { HarvestRunRepository } from "../db/harvest-run-repository";
import { ToolRegistry } from "../tools/tool-registry";
import { PromptLibrary } from "../agent/prompt-library";
import { SubagentCatalog } from "../agent/subagent-catalog";
import { HarvestAgent } from "../agent/harvest-agent";
import { PageWriterAgent } from "../agent/page-writer-agent";
import { KeywordQueue } from "./keyword-queue";
import { RunArtifacts } from "./run-artifacts";
import { RunContext } from "./run-context";
import { RunRecorder } from "./run-recorder";
import { HarvestRunner } from "./harvest-runner";
import { ShutdownSignal } from "./shutdown-signal";
import { ExitCode } from "./exit-code";

export class Application {
    readonly config: Config;
    readonly logger: Logger;
    readonly database: Database;

    private readonly runId = randomUUID();
    private readonly usage: UsageTracker;
    private readonly browser: BrowserPool;
    private readonly keywords: KeywordRepository;
    private readonly websites: WebsiteRepository;
    private readonly pages: PageRepository;
    private readonly runs: HarvestRunRepository;
    private readonly queue: KeywordQueue;
    private readonly shutdown: ShutdownSignal;

    constructor(config: Config = Config.load()) {
        this.config = config;
        this.logger = new Logger({
            runId: this.runId,
            format: config.logFormat,
            level: config.logLevel,
        });

        this.shutdown = new ShutdownSignal(this.logger);
        this.usage = new UsageTracker(config.tokenBudget, (error) => {
            this.logger.error(`budget: ${error.message} — aborting the run`);
            this.shutdown.request("TOKEN_BUDGET exhausted");
        });
        this.browser = new BrowserPool(config, this.logger);
        this.database = new Database(config, this.logger);

        this.keywords = new KeywordRepository(this.database, this.logger);
        this.websites = new WebsiteRepository(this.database, config.siteDomain);
        this.pages = new PageRepository(this.database, this.websites);
        this.runs = new HarvestRunRepository(this.database);

        this.queue = new KeywordQueue(config, this.database, this.keywords);
    }

    listenForShutdown(process: NodeJS.Process): void {
        this.shutdown.listenToProcess(process);
    }

    async execute(requestedKeyword: string | null): Promise<ExitCode> {
        const problems = this.config.validate();
        if (problems.length) {
            for (const problem of problems) this.logger.error(`config: ${problem}`);
            return ExitCode.Misconfigured;
        }

        const keyword = await this.queue.claim(requestedKeyword);
        if (!keyword) {
            this.logger.info("queue: no unclaimed keywords left — nothing to do");
            return ExitCode.QueueEmpty;
        }

        this.logger.withKeyword(keyword.keyword);

        return this.buildRunner(new RunContext(keyword, this.runId)).run();
    }

    private buildRunner(context: RunContext): HarvestRunner {
        const workspace = new Workspace(this.config.workspaceRoot, context.slug, this.config.outputDir);
        const artifacts = new RunArtifacts();

        const urls = new AmazonUrls(this.config.affiliateTag);
        const scraper = new AmazonScraper(new PageNavigator(this.browser), urls);
        const models = new ModelFactory(this.config, this.usage);
        const prompts = new PromptLibrary(this.config);

        const tools = new ToolRegistry({
            config: this.config,
            workspace,
            scraper,
            ranker: new ProductRanker(),
            artifacts,
        });

        const harvestAgent = new HarvestAgent(
            this.config,
            this.logger,
            models,
            workspace,
            tools,
            new SubagentCatalog(tools, models),
            prompts,
        );

        const pageWriter = new PageWriterAgent(
            this.config,
            this.logger,
            models,
            workspace,
            tools,
            prompts,
            this.pages,
            artifacts,
        );

        const recorder = new RunRecorder(
            this.config,
            this.logger,
            this.database,
            this.runs,
            this.websites,
            workspace,
            this.usage,
            artifacts,
        );

        return new HarvestRunner(
            this.config,
            this.logger,
            context,
            workspace,
            this.browser,
            this.database,
            this.pages,
            this.websites,
            harvestAgent,
            pageWriter,
            recorder,
            this.queue,
            artifacts,
            this.shutdown,
        );
    }

    reportUsage(): void {
        const totals = this.usage.snapshot();
        const format = (value: number) => value.toLocaleString("en-US");

        if (!totals.calls) {
            this.logger.info("tokens:  no model calls recorded");
            return;
        }

        const fraction = this.usage.budgetFraction;
        const share = fraction === null ? "" : ` · ${Math.round(fraction * 100)}% of budget`;

        this.logger.info(
            `tokens:  ${format(totals.inputTokens)} in · ${format(totals.outputTokens)} out · ` +
                `${format(this.usage.totalTokens)} total (${format(totals.calls)} llm call` +
                `${totals.calls === 1 ? "" : "s"})${share}`,
            {
                inputTokens: totals.inputTokens,
                outputTokens: totals.outputTokens,
                llmCalls: totals.calls,
            },
        );

        const extra = [
            totals.cachedTokens ? `${format(totals.cachedTokens)} cached in` : "",
            totals.reasoningTokens ? `${format(totals.reasoningTokens)} reasoning out` : "",
        ].filter(Boolean);

        if (extra.length) this.logger.info(`         ${extra.join(" · ")}`);
    }

    async shutdownResources(): Promise<void> {
        await Promise.allSettled([this.browser.close(), this.database.close()]);
    }
}
