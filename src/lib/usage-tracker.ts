import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

export type UsageTotals = {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
};

export class TokenBudgetExceededError extends Error {
    constructor(spent: number, budget: number) {
        super(`token budget exhausted: ${spent.toLocaleString("en-US")} of ${budget.toLocaleString("en-US")}`);
        this.name = "TokenBudgetExceededError";
    }
}

export class UsageTracker extends BaseCallbackHandler {
    readonly name = "usage-tracker";

    private readonly totals: UsageTotals = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
    };

    private tripped = false;

    // langchain wraps every callback in try/catch and only logs what it catches, so a
    // throw from in here does NOT stop the run — it prints once per call while the agent
    // keeps spending. The budget has to be enforced by aborting the run instead.
    constructor(
        private readonly tokenBudget: number,
        private readonly onExhausted: (error: TokenBudgetExceededError) => void = () => {},
    ) {
        super();
    }

    handleLLMEnd(output: LLMResult): void {
        this.totals.calls += 1;

        for (const generation of output.generations.flat()) {
            const usage = (generation as { message?: { usage_metadata?: Record<string, any> } }).message
                ?.usage_metadata;

            if (usage) {
                this.totals.inputTokens += usage.input_tokens ?? 0;
                this.totals.outputTokens += usage.output_tokens ?? 0;
                this.totals.cachedTokens += usage.input_token_details?.cache_read ?? 0;
                this.totals.reasoningTokens += usage.output_token_details?.reasoning ?? 0;
                continue;
            }

            const raw = output.llmOutput?.tokenUsage;
            if (raw) {
                this.totals.inputTokens += raw.promptTokens ?? 0;
                this.totals.outputTokens += raw.completionTokens ?? 0;
            }
        }

        this.enforceBudget();
    }

    private enforceBudget(): void {
        if (!this.tokenBudget || this.tripped) return;

        const spent = this.totalTokens;
        if (spent < this.tokenBudget) return;

        this.tripped = true;
        this.onExhausted(new TokenBudgetExceededError(spent, this.tokenBudget));
    }

    snapshot(): Readonly<UsageTotals> {
        return { ...this.totals };
    }

    get totalTokens(): number {
        return this.totals.inputTokens + this.totals.outputTokens;
    }

    get budgetFraction(): number | null {
        return this.tokenBudget ? this.totalTokens / this.tokenBudget : null;
    }
}
