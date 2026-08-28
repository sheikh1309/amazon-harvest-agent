import type { Database } from "./database";
import type { KeywordRow } from "./keyword-repository";

export type RunStatus = "succeeded" | "partial" | "failed";

export type HarvestRunRecord = {
    id: string;
    websiteId: string | null;
    keyword: KeywordRow;
    pageId: string | null;
    status: RunStatus;
    error: string | null;
    output: unknown | null;
    report: string | null;
    candidatesFound: number;
    productsScraped: number;
    productsPublished: number;
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
};

export class HarvestRunRepository {
    constructor(private readonly database: Database) {}

    async save(run: HarvestRunRecord): Promise<void> {
        await this.database.query(
            `insert into harvest_runs (
                id, website_id, keyword_id, page_id, keyword, status, error, output, report,
                candidates_found, products_scraped, products_published,
                llm_calls, input_tokens, output_tokens, duration_ms
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
                run.id,
                run.websiteId,
                run.keyword.id,
                run.pageId,
                run.keyword.keyword,
                run.status,
                run.error,
                run.output === null ? null : JSON.stringify(run.output),
                run.report,
                run.candidatesFound,
                run.productsScraped,
                run.productsPublished,
                run.llmCalls,
                run.inputTokens,
                run.outputTokens,
                run.durationMs,
            ],
        );
    }
}
