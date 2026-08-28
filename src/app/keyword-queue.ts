import type { Config } from "../lib/config";
import type { Database } from "../db/database";
import type { KeywordRepository, KeywordRow } from "../db/keyword-repository";

export class KeywordQueue {
    constructor(
        private readonly config: Config,
        private readonly database: Database,
        private readonly keywords: KeywordRepository,
    ) {}

    async claim(requestedKeyword: string | null): Promise<KeywordRow | null> {
        if (!this.database.enabled) return this.adHoc(requestedKeyword);
        if (requestedKeyword) return this.claimNamed(requestedKeyword);
        return this.keywords.claimNext(this.config.claimTimeoutMinutes);
    }

    async release(keyword: KeywordRow): Promise<void> {
        if (!this.database.enabled || !keyword.id) return;
        await this.keywords.release(keyword.id);
    }

    private adHoc(requestedKeyword: string | null): KeywordRow {
        if (!requestedKeyword) {
            throw new Error("DATABASE_URL is not set, so a keyword must be given on the command line");
        }
        return { id: null, keyword: requestedKeyword, category_id: "" };
    }

    private async claimNamed(keyword: string): Promise<KeywordRow> {
        const claimed = await this.keywords.claimByName(keyword);
        if (claimed) return claimed;

        if (!this.config.categoryId) {
            throw new Error(
                `"${keyword}" is not in the keywords table and CATEGORY_ID is unset — ` +
                    "nothing to attribute the products to",
            );
        }
        return { id: null, keyword, category_id: this.config.categoryId };
    }
}
