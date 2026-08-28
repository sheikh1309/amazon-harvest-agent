import "dotenv/config";
import { resolve } from "node:path";

export type LogFormat = "text" | "json";

export class Config {
    readonly affiliateTag: string;
    readonly model: string;
    readonly fallbackModels: string[];
    readonly temperature: number;
    readonly maxOutputTokens: number;
    readonly tokenBudget: number;
    readonly runTimeoutMs: number;
    readonly concurrency: number;
    readonly headless: boolean;
    readonly zip: string;
    readonly proxy: string | null;
    readonly requireUsPricing: boolean;
    readonly maxPages: number;
    readonly candidateCount: number;
    readonly finalCount: number;
    readonly minRating: number;
    readonly minReviews: number;
    readonly workspaceRoot: string;
    readonly outputDir: string;
    readonly cleanupWorkspace: boolean;
    readonly databaseUrl: string | null;
    readonly migrationsDir: string;
    readonly claimTimeoutMinutes: number;
    readonly recordRunPayload: boolean;
    readonly pageDryRun: boolean;
    readonly siteDomain: string;
    readonly categoryId: string | null;
    readonly logFormat: LogFormat;
    readonly logLevel: string;
    readonly userAgent: string;
    readonly openRouterApiKey: string | null;

    private constructor(env: NodeJS.ProcessEnv) {
        this.affiliateTag = env.AFFILIATE_TAG ?? "best10deals-20";
        this.model = env.AGENT_MODEL ?? "anthropic/claude-sonnet-4.5";
        this.fallbackModels = Config.toList(env.AGENT_FALLBACK_MODELS);
        this.temperature = Config.toNumber(env.MODEL_TEMPERATURE, 0.2);
        this.maxOutputTokens = Config.toNumber(env.MAX_OUTPUT_TOKENS, 16_000);
        this.tokenBudget = Config.toNumber(env.TOKEN_BUDGET, 2_000_000);
        this.runTimeoutMs = Config.toNumber(env.RUN_TIMEOUT_MINUTES, 30) * 60_000;

        this.concurrency = Config.toNumber(env.CONCURRENCY, 6);
        this.headless = env.HEADFUL !== "1";
        this.zip = env.AMAZON_ZIP ?? "10001";
        this.proxy = env.PROXY_SERVER || null;
        this.requireUsPricing = env.REQUIRE_US_PRICING === "1";

        this.maxPages = Config.toNumber(env.MAX_PAGES, 3);
        this.candidateCount = Config.toNumber(env.CANDIDATE_COUNT, 30);
        this.finalCount = Config.toNumber(env.FINAL_COUNT, 10);
        this.minRating = Config.toNumber(env.MIN_RATING, 4.0);
        this.minReviews = Config.toNumber(env.MIN_REVIEWS, 100);

        this.workspaceRoot = env.WORKSPACE ?? "workspace";
        this.outputDir = env.OUTPUT_DIR ?? "output";
        this.cleanupWorkspace = env.KEEP_WORKSPACE !== "1";

        this.databaseUrl = env.DATABASE_URL || null;
        this.migrationsDir = resolve(env.MIGRATIONS_DIR ?? "migrations");
        this.claimTimeoutMinutes = Config.toNumber(env.KEYWORD_CLAIM_TIMEOUT_MINUTES, 60);
        this.recordRunPayload = env.RECORD_RUN_PAYLOAD === "1";
        this.pageDryRun = env.PAGE_DRY_RUN === "1";
        this.siteDomain = env.SITE_DOMAIN ?? "best10deals.com";
        this.categoryId = env.CATEGORY_ID || null;

        this.logFormat = env.LOG_FORMAT === "json" ? "json" : "text";
        this.logLevel = env.LOG_LEVEL ?? "info";
        this.openRouterApiKey = env.OPENROUTER_API_KEY || null;

        this.userAgent =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
    }

    static load(env: NodeJS.ProcessEnv = process.env): Config {
        return new Config(env);
    }

    get databaseEnabled(): boolean {
        return this.databaseUrl !== null;
    }

    get claimTimeoutMs(): number {
        return this.claimTimeoutMinutes * 60_000;
    }

    validate(): string[] {
        const problems: string[] = [];

        if (!this.openRouterApiKey) {
            problems.push("OPENROUTER_API_KEY is not set — every model call will fail with 401");
        }
        if (!this.model.trim()) {
            problems.push("AGENT_MODEL is empty");
        }
        if (this.concurrency < 1 || this.concurrency > 12) {
            problems.push(`CONCURRENCY=${this.concurrency} is outside 1-12; >6 from one IP gets captcha'd`);
        }
        if (this.finalCount < 1) {
            problems.push(`FINAL_COUNT=${this.finalCount} must be at least 1`);
        }
        if (this.candidateCount < this.finalCount) {
            problems.push(`CANDIDATE_COUNT=${this.candidateCount} is below FINAL_COUNT=${this.finalCount}`);
        }
        if (this.runTimeoutMs && this.claimTimeoutMs < this.runTimeoutMs) {
            problems.push(
                `KEYWORD_CLAIM_TIMEOUT_MINUTES=${this.claimTimeoutMinutes} is below ` +
                    `RUN_TIMEOUT_MINUTES=${this.runTimeoutMs / 60_000} — a slow run would have its keyword reclaimed`,
            );
        }

        return problems;
    }

    private static toNumber(value: string | undefined, fallback: number): number {
        const parsed = value ? Number(value) : Number.NaN;
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    private static toList(value: string | undefined): string[] {
        return (value ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
}
