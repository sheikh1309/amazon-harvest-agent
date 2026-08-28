import type { Logger } from "../lib/logger";
import { ExitCode } from "./exit-code";

export class ShutdownSignal {
    private reasonValue: string | null = null;
    private readonly controller = new AbortController();

    constructor(private readonly logger: Logger) {}

    get reason(): string | null {
        return this.reasonValue;
    }

    get requested(): boolean {
        return this.reasonValue !== null;
    }

    request(reason: string): void {
        if (this.reasonValue) return;

        this.reasonValue = reason;
        // Aborts the in-flight model call as well as the graph. throwIfRequested only
        // fires between stream updates, which a subagent mid-call will not reach.
        this.controller.abort(new Error(`aborted: ${reason}`));
    }

    throwIfRequested(): void {
        if (this.reasonValue) throw new Error(`aborted: ${this.reasonValue}`);
    }

    // Always returns the run's signal, timeout or not: TOKEN_BUDGET and SIGINT abort
    // through the same controller, and they need a signal on the call either way.
    deadline(timeoutMs: number): AbortSignal {
        if (timeoutMs) {
            const timer = setTimeout(
                () => this.request(`exceeded RUN_TIMEOUT_MINUTES (${timeoutMs / 60_000}m)`),
                timeoutMs,
            );

            timer.unref();
        }

        return this.controller.signal;
    }

    listenToProcess(process: NodeJS.Process): void {
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            process.on(signal, () => {
                if (this.requested) process.exit(ExitCode.Interrupted);

                this.request(signal);
                this.logger.warn(`\n${signal} received — finishing the current step, then shutting down`);
            });
        }

        process.on("unhandledRejection", (reason) => {
            this.logger.error(
                `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
            );
            this.request("unhandledRejection");
        });
    }
}
