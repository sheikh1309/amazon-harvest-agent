import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "./database";

export type Migration = {
    version: number;
    description: string;
    path: string;
    sql: string;
    checksum: Uint8Array;
};

export type MigrationResult = {
    applied: Migration[];
    skipped: number;
    drifted: { version: number; description: string }[];
};

const MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export class Migrator {
    constructor(
        private readonly database: Database,
        private readonly directory: string,
    ) {}

    async load(): Promise<Migration[]> {
        const files = await readdir(this.directory);

        const migrations = await Promise.all(
            files.map(async (file) => {
                const match = MIGRATION_FILE.exec(file);
                if (!match) return null;

                const path = join(this.directory, file);
                const bytes = await readFile(path);

                return {
                    version: Number(match[1]),
                    description: match[2].replace(/_/g, " "),
                    path,
                    sql: bytes.toString("utf8"),
                    checksum: createHash("sha384").update(bytes).digest(),
                };
            }),
        );

        return migrations.filter((migration) => migration !== null).sort((a, b) => a.version - b.version);
    }

    async run(): Promise<MigrationResult> {
        const migrations = await this.load();

        return this.database.withClient(async (client) => {
            await client.query(`
                create table if not exists _sqlx_migrations (
                    version bigint primary key,
                    description text not null,
                    installed_on timestamp with time zone not null default now(),
                    success boolean not null,
                    checksum bytea not null,
                    execution_time bigint not null
                )`);

            const { rows } = await client.query<{ version: string; checksum: Buffer }>(
                "select version, checksum from _sqlx_migrations",
            );
            const applied = new Map(rows.map((row) => [Number(row.version), row.checksum]));

            const result: MigrationResult = { applied: [], skipped: 0, drifted: [] };

            for (const migration of migrations) {
                const recorded = applied.get(migration.version);

                if (recorded) {
                    if (!recorded.equals(migration.checksum)) {
                        result.drifted.push({
                            version: migration.version,
                            description: migration.description,
                        });
                    }
                    result.skipped++;
                    continue;
                }

                const startedAt = Date.now();
                try {
                    await client.query("begin");
                    await client.query(migration.sql);
                    await client.query(
                        `insert into _sqlx_migrations (version, description, success, checksum, execution_time)
                         values ($1, $2, true, $3, $4)`,
                        [
                            migration.version,
                            migration.description,
                            migration.checksum,
                            (Date.now() - startedAt) * NANOSECONDS_PER_MILLISECOND,
                        ],
                    );
                    await client.query("commit");
                } catch (error) {
                    await client.query("rollback").catch(() => {});
                    throw new Error(
                        `migration ${migration.version} (${migration.description}) failed: ${(error as Error).message}`,
                    );
                }

                result.applied.push(migration);
            }

            return result;
        });
    }
}
