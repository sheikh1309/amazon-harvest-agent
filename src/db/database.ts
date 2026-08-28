import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";

export class Database {
    private pool: Pool | null = null;

    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
    ) {}

    get enabled(): boolean {
        return this.config.databaseEnabled;
    }

    private connectionPool(): Pool {
        if (!this.config.databaseUrl) throw new Error("DATABASE_URL is not set");

        if (!this.pool) {
            this.pool = new Pool({
                connectionString: this.config.databaseUrl,
                ssl: sslSettings(this.config.databaseUrl),
                max: 2,
                connectionTimeoutMillis: 15_000,
                idleTimeoutMillis: 30_000,
            });
            this.pool.on("error", (error) =>
                this.logger.warn(`db: idle connection dropped (${error.message})`),
            );
        }

        return this.pool;
    }

    async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
        return this.connectionPool().query<T>(sql, params);
    }

    async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.connectionPool().connect();
        try {
            return await work(client);
        } finally {
            client.release();
        }
    }

    async transaction<T>(work: (client: PoolClient) => Promise<T>, options: { rollback?: boolean } = {}) {
        return this.withClient(async (client) => {
            try {
                await client.query("begin");
                const result = await work(client);
                await client.query(options.rollback ? "rollback" : "commit");
                return result;
            } catch (error) {
                await client.query("rollback").catch(() => {});
                throw error;
            }
        });
    }

    async close(): Promise<void> {
        await this.pool?.end();
        this.pool = null;
    }
}

// Neon and every other hosted postgres wants a verified TLS connection; a postgres on
// localhost answers the SSLRequest with "N" and pg turns that into "The server does not
// support SSL connections" before the first query. Honour sslmode when the URL sets it,
// otherwise decide from the host, so the same code works against both.
function sslSettings(connectionString: string): PoolConfig["ssl"] {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        return { rejectUnauthorized: true };
    }

    const mode = url.searchParams.get("sslmode");
    if (mode) {
        if (mode === "disable") return false;
        if (mode === "no-verify" || mode === "prefer") return { rejectUnauthorized: false };
        return { rejectUnauthorized: true };
    }

    const host = url.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
    return local ? false : { rejectUnauthorized: true };
}
