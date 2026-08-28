export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LoggerOptions = {
    runId: string;
    format: "text" | "json";
    level: string;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
};

export class Logger {
    private readonly runId: string;
    private readonly format: "text" | "json";
    private readonly threshold: number;
    private readonly stdout: NodeJS.WritableStream;
    private readonly stderr: NodeJS.WritableStream;
    private keyword: string | null = null;

    constructor(options: LoggerOptions) {
        this.runId = options.runId;
        this.format = options.format;
        this.threshold = SEVERITY[options.level as LogLevel] ?? SEVERITY.info;
        this.stdout = options.stdout ?? process.stdout;
        this.stderr = options.stderr ?? process.stderr;
    }

    withKeyword(keyword: string): void {
        this.keyword = keyword;
    }

    debug(message: string, fields?: LogFields): void {
        this.write("debug", message, fields);
    }

    info(message: string, fields?: LogFields): void {
        this.write("info", message, fields);
    }

    warn(message: string, fields?: LogFields): void {
        this.write("warn", message, fields);
    }

    error(message: string, fields?: LogFields): void {
        this.write("error", message, fields);
    }

    blankLine(): void {
        if (this.format === "text") this.stdout.write("\n");
    }

    private write(level: LogLevel, message: string, fields?: LogFields): void {
        if (SEVERITY[level] < this.threshold) return;

        const stream = level === "error" || level === "warn" ? this.stderr : this.stdout;

        if (this.format === "json") {
            stream.write(
                JSON.stringify({
                    ts: new Date().toISOString(),
                    level,
                    run: this.runId,
                    ...(this.keyword ? { keyword: this.keyword } : {}),
                    message,
                    ...fields,
                }) + "\n",
            );
            return;
        }

        const suffix = fields && Object.keys(fields).length ? `  ${Logger.formatFields(fields)}` : "";
        stream.write(`${message}${suffix}\n`);
    }

    private static formatFields(fields: LogFields): string {
        return Object.entries(fields)
            .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
            .join(" ");
    }
}
