import { describe, expect, it, vi } from "vitest";
import type { LLMResult } from "@langchain/core/outputs";
import { TokenBudgetExceededError, UsageTracker } from "../src/lib/usage-tracker";

function result(inputTokens: number, outputTokens: number): LLMResult {
    return {
        generations: [
            [
                {
                    text: "",
                    message: { usage_metadata: { input_tokens: inputTokens, output_tokens: outputTokens } },
                } as never,
            ],
        ],
    };
}

describe("UsageTracker budget enforcement", () => {
    it("fires onExhausted once the budget is spent", () => {
        const onExhausted = vi.fn();
        const tracker = new UsageTracker(1000, onExhausted);

        tracker.handleLLMEnd(result(400, 100));
        expect(onExhausted).not.toHaveBeenCalled();

        tracker.handleLLMEnd(result(400, 100));
        expect(onExhausted).toHaveBeenCalledOnce();
        expect(onExhausted.mock.calls[0][0]).toBeInstanceOf(TokenBudgetExceededError);
    });

    it("fires only once, so an abort in flight is not re-requested per call", () => {
        const onExhausted = vi.fn();
        const tracker = new UsageTracker(100, onExhausted);

        for (let call = 0; call < 5; call += 1) tracker.handleLLMEnd(result(100, 0));

        expect(onExhausted).toHaveBeenCalledOnce();
    });

    it("never fires when TOKEN_BUDGET is 0, which disables the ceiling", () => {
        const onExhausted = vi.fn();
        const tracker = new UsageTracker(0, onExhausted);

        tracker.handleLLMEnd(result(10_000_000, 10_000_000));

        expect(onExhausted).not.toHaveBeenCalled();
    });

    it("counts cached and reasoning tokens without double-counting the totals", () => {
        const tracker = new UsageTracker(0);

        tracker.handleLLMEnd({
            generations: [
                [
                    {
                        text: "",
                        message: {
                            usage_metadata: {
                                input_tokens: 900,
                                output_tokens: 100,
                                input_token_details: { cache_read: 800 },
                                output_token_details: { reasoning: 40 },
                            },
                        },
                    } as never,
                ],
            ],
        });

        expect(tracker.snapshot()).toEqual({
            calls: 1,
            inputTokens: 900,
            outputTokens: 100,
            cachedTokens: 800,
            reasoningTokens: 40,
        });
        expect(tracker.totalTokens).toBe(1000);
    });
});
