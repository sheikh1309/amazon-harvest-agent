import { randomUUID } from "node:crypto";
import { slugify } from "../lib/text";
import type { KeywordRow } from "../db/keyword-repository";

export class RunContext {
    readonly id: string;
    readonly keyword: KeywordRow;
    readonly slug: string;
    readonly startedAt: number;

    constructor(keyword: KeywordRow, id: string = randomUUID(), startedAt: number = Date.now()) {
        const slug = slugify(keyword.keyword);
        if (!slug) {
            throw new Error(
                `keyword "${keyword.keyword}" has no alphanumeric characters to build a slug from`,
            );
        }

        this.id = id;
        this.keyword = keyword;
        this.slug = slug;
        this.startedAt = startedAt;
    }

    get keywordText(): string {
        return this.keyword.keyword;
    }

    get isQueuedKeyword(): boolean {
        return this.keyword.id !== null;
    }

    get elapsedMs(): number {
        return Date.now() - this.startedAt;
    }
}
