import "dotenv/config";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { Database } from "../db/database";

const DEFAULT_LIMIT_BYTES = 512 * 1024 * 1024;
const MIN_RECLAIMABLE_BYTES = 1024 * 1024;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type TableSize = { name: string; total: string; heap: string; idx: string };
type IndexCandidate = { name: string; tbl: string; bytes: string; why: string };

async function main(): Promise<void> {
    const config = Config.load();
    if (!config.databaseEnabled) throw new Error("DATABASE_URL is not set");

    const logger = new Logger({ runId: "db-size", format: "text", level: config.logLevel });
    const database = new Database(config, logger);
    const limitBytes = Number(process.env.DB_SIZE_LIMIT_BYTES ?? DEFAULT_LIMIT_BYTES);

    try {
        await database.withClient(async (client) => {
            const { rows: size } = await client.query<{ bytes: string }>(
                "select pg_database_size(current_database()) as bytes",
            );
            const used = Number(size[0].bytes);
            const percentage = Math.round((used / limitBytes) * 100);

            console.log(`\nused: ${megabytes(used)} of ${megabytes(limitBytes)}  (${percentage}%)`);
            if (percentage >= 95) {
                console.log("      ^ writes will start failing; see the reclaim candidates below");
            }

            const { rows: tables } = await client.query<TableSize>(`
                select c.relname as name,
                       pg_total_relation_size(c.oid) as total,
                       pg_relation_size(c.oid) as heap,
                       pg_indexes_size(c.oid) as idx
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                order by pg_total_relation_size(c.oid) desc`);

            console.log("\ntable                     total       heap        indexes");
            for (const table of tables) {
                console.log(
                    `${table.name.padEnd(25)} ${megabytes(Number(table.total)).padEnd(11)} ` +
                        `${megabytes(Number(table.heap)).padEnd(11)} ${megabytes(Number(table.idx))}`,
                );
            }

            const { rows: duplicates } = await client.query<IndexCandidate>(
                `select dup.relname as name, t.relname as tbl,
                        pg_relation_size(dup.oid) as bytes,
                        'duplicate of unique ' || uniq.relname as why
                 from pg_index duplicate_index
                 join pg_class dup on dup.oid = duplicate_index.indexrelid
                 join pg_class t on t.oid = duplicate_index.indrelid
                 join pg_index unique_index on unique_index.indrelid = duplicate_index.indrelid
                                           and unique_index.indexrelid <> duplicate_index.indexrelid
                                           and unique_index.indisunique
                                           and unique_index.indkey::text = duplicate_index.indkey::text
                 join pg_class uniq on uniq.oid = unique_index.indexrelid
                 where not duplicate_index.indisunique
                 order by pg_relation_size(dup.oid) desc`,
            );

            const { rows: unused } = await client.query<IndexCandidate>(
                `select i.relname as name, t.relname as tbl,
                        pg_relation_size(i.oid) as bytes,
                        'never scanned' as why
                 from pg_stat_user_indexes s
                 join pg_class i on i.oid = s.indexrelid
                 join pg_class t on t.oid = s.relid
                 join pg_index ix on ix.indexrelid = i.oid
                 where s.idx_scan = 0 and not ix.indisunique and not ix.indisprimary
                   and pg_relation_size(i.oid) > $1
                 order by pg_relation_size(i.oid) desc`,
                [MIN_RECLAIMABLE_BYTES],
            );

            const candidates = [
                ...duplicates,
                ...unused.filter((index) => !duplicates.some((dup) => dup.name === index.name)),
            ];

            if (!candidates.length) {
                console.log("\nno obviously reclaimable indexes.");
                return;
            }

            const total = candidates.reduce((sum, index) => sum + Number(index.bytes), 0);
            console.log(`\nreclaimable indexes — ${megabytes(total)} across ${candidates.length}:`);
            for (const index of candidates) {
                console.log(
                    `  ${megabytes(Number(index.bytes)).padStart(9)}  ${index.name}  (${index.tbl}, ${index.why})`,
                );
            }

            console.log("\n  review each one before dropping it — 'never scanned' can mean");
            console.log("  'the feature that uses it has not shipped yet':");
            for (const index of candidates) console.log(`    drop index concurrently ${index.name};`);
            console.log();
        });
    } finally {
        await database.close();
    }
}

main().catch((error: Error) => {
    console.error(`\ndb:size failed: ${error.message}`);
    process.exitCode = 1;
});
