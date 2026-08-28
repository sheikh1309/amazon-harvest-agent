import type { Database } from "./database";
import type { Logger } from "../lib/logger";

export type KeywordRow = {
    id: string | null;
    keyword: string;
    category_id: string;
};

export class KeywordRepository {
    constructor(
        private readonly database: Database,
        private readonly logger: Logger,
    ) {}

    async claimNext(claimTimeoutMinutes: number): Promise<KeywordRow | null> {
        const { rows } = await this.database.query<KeywordRow>(
            `update keywords set claimed_at = now()
             where id = (
                 select id from keywords
                 where processed_at is null
                   and (claimed_at is null or claimed_at < now() - make_interval(mins => $1))
                 order by created_at, id
                 for update skip locked
                 limit 1
             )
             returning id, keyword, category_id`,
            [claimTimeoutMinutes],
        );

        return rows[0] ?? null;
    }

    async claimByName(keyword: string): Promise<KeywordRow | null> {
        const { rows } = await this.database.query<KeywordRow>(
            `update keywords set claimed_at = now()
             where lower(keyword) = lower($1)
             returning id, keyword, category_id`,
            [keyword],
        );

        return rows[0] ?? null;
    }

    async release(id: string): Promise<void> {
        await this.database
            .query("update keywords set claimed_at = null where id = $1 and processed_at is null", [id])
            .catch((error: Error) =>
                this.logger.warn(`db: could not release keyword claim (${error.message})`),
            );
    }
}
