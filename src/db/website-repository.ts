import type { Database } from "./database";

export type Website = {
    id: string;
    trackingId: string;
};

export class WebsiteRepository {
    private cached: Website | null = null;

    constructor(
        private readonly database: Database,
        private readonly domain: string,
    ) {}

    async current(): Promise<Website> {
        if (this.cached) return this.cached;

        const { rows } = await this.database.query<{ id: string; default_tracking_id: string }>(
            "select id, default_tracking_id from websites where domain = $1",
            [this.domain],
        );
        if (!rows.length) throw new Error(`no websites row for domain ${this.domain}`);

        this.cached = { id: rows[0].id, trackingId: rows[0].default_tracking_id };
        return this.cached;
    }

    async navigationCategories(): Promise<string[]> {
        const { rows } = await this.database.query<{ parent_category: string }>(
            "select distinct parent_category from pages where is_active order by 1",
        );
        return rows.map((row) => row.parent_category);
    }
}
