import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";
import type { Workspace } from "../lib/workspace";
import type { UsageTracker } from "../lib/usage-tracker";
import type { Database } from "../db/database";
import type { HarvestRunRepository, RunStatus } from "../db/harvest-run-repository";
import type { WebsiteRepository } from "../db/website-repository";
import type { RunArtifacts } from "./run-artifacts";
import type { RunContext } from "./run-context";

export type RunOutcome = {
    status: RunStatus;
    error: string | null;
    productsPublished: number;
};

export class RunRecorder {
    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
        private readonly database: Database,
        private readonly runs: HarvestRunRepository,
        private readonly websites: WebsiteRepository,
        private readonly workspace: Workspace,
        private readonly usage: UsageTracker,
        private readonly artifacts: RunArtifacts,
    ) {}

    async record(context: RunContext, outcome: RunOutcome): Promise<void> {
        if (!this.database.enabled) {
            this.logger.info("run: not recorded — DATABASE_URL is not set, workspace left intact");
            return;
        }

        if (this.config.pageDryRun) {
            this.logger.info("run: not recorded — PAGE_DRY_RUN is set, workspace left intact");
            return;
        }

        const scrapedAsins = await this.workspace.scrapedAsins();
        const { output, report } = await this.payload(context);
        const totals = this.usage.snapshot();

        try {
            await this.runs.save({
                id: context.id,
                websiteId: await this.websites.current().then((site) => site.id).catch(() => null),
                keyword: context.keyword,
                pageId: this.artifacts.pageId,
                status: outcome.status,
                error: outcome.error,
                output,
                report,
                candidatesFound: await this.candidateCount(context),
                productsScraped: scrapedAsins.length,
                productsPublished: outcome.productsPublished,
                llmCalls: totals.calls,
                inputTokens: totals.inputTokens,
                outputTokens: totals.outputTokens,
                durationMs: context.elapsedMs,
            });
        } catch (error) {
            this.logger.error(
                `run: FAILED to record (${(error as Error).message}) — workspace left intact`,
            );
            return;
        }

        this.logger.info(
            `run: recorded in harvest_runs (${outcome.status}, ${scrapedAsins.length} scraped, ` +
                `${outcome.productsPublished} published${output ? ", payload stored" : ""})`,
        );

        await this.cleanUp(outcome.status);
    }

    private async payload(context: RunContext): Promise<{ output: unknown | null; report: string | null }> {
        const outputPath = await this.outputPath(context);
        if (!this.config.recordRunPayload || !outputPath) return { output: null, report: null };

        return {
            output: await this.workspace.readJsonOrNull<unknown>(outputPath),
            report: await this.workspace.readTextOrNull(outputPath.replace(/\.json$/, ".md")),
        };
    }

    async outputPath(context: RunContext): Promise<string | null> {
        return this.artifacts.outputPath ?? (await this.workspace.newestOutput(context.slug));
    }

    private async candidateCount(context: RunContext): Promise<number> {
        const file = await this.workspace.readJsonOrNull<{ candidates: unknown[] }>(
            `candidates/${context.slug}.json`,
        );
        return file?.candidates?.length ?? 0;
    }

    private async cleanUp(status: RunStatus): Promise<void> {
        if (!this.config.cleanupWorkspace) {
            this.logger.info("run: workspace kept (KEEP_WORKSPACE=1)");
            return;
        }

        if (status !== "succeeded") {
            this.logger.info(`run: workspace kept — status ${status}, a retry will resume from it`);
            return;
        }

        await this.workspace
            .destroy()
            .catch((error: Error) => this.logger.warn(`run: workspace cleanup failed (${error.message})`));

        this.logger.info(`run: cleared ${this.workspace.root}`);
    }
}
