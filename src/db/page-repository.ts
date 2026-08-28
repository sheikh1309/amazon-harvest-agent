import type { PoolClient } from "pg";
import type { Database } from "./database";
import type { KeywordRow } from "./keyword-repository";
import type { WebsiteRepository } from "./website-repository";
import { ProductMapper } from "./product-mapper";
import { slugify } from "../lib/text";
import type { PageContent, PageProduct } from "../schema/page";
import type { Product } from "../schema/product";

const UPSERT_PRODUCT = `
insert into products (
    category_id, asin, title, brand, price, currency, image_url, rating, review_count,
    features, specifications, description, affiliate_url, is_available, last_fetched_at, updated_at
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
on conflict (asin) do update set
    title = excluded.title, brand = excluded.brand, price = excluded.price,
    currency = excluded.currency, image_url = excluded.image_url, rating = excluded.rating,
    review_count = excluded.review_count, features = excluded.features,
    specifications = excluded.specifications, description = excluded.description,
    affiliate_url = excluded.affiliate_url, is_available = excluded.is_available,
    last_fetched_at = excluded.last_fetched_at, updated_at = now()
returning id, (xmax = 0) as inserted`;

export type SavePageResult = {
    slug: string;
    pageId: string;
    productsInserted: number;
    productsUpdated: number;
    skipped: string[];
    keywordMarkedProcessed: boolean;
    rolledBack: boolean;
};

export class PageRepository {
    private readonly mapper = new ProductMapper();

    constructor(
        private readonly database: Database,
        private readonly websites: WebsiteRepository,
    ) {}

    async findSlugForKeyword(keywordId: string): Promise<string | null> {
        const { rows } = await this.database.query<{ slug: string }>(
            "select slug from pages where keyword_id = $1",
            [keywordId],
        );
        return rows[0]?.slug ?? null;
    }

    async save(
        keyword: KeywordRow,
        content: PageContent,
        scrapedProducts: Map<string, Product>,
        options: { dryRun?: boolean } = {},
    ): Promise<SavePageResult> {
        const website = await this.websites.current();
        const dryRun = options.dryRun ?? false;

        return this.database.transaction(async (client) => {
            const parentCategory = content.parent_category.slice(0, 100);
            const categoryId = await this.upsertCategory(client, parentCategory);

            const { rows, skipped, inserted, updated } = await this.upsertProducts(
                client,
                content.products,
                scrapedProducts,
                keyword.category_id,
                website.trackingId,
            );

            if (!rows.length) throw new Error("no products could be saved — refusing to write an empty page");

            const pageSlug = slugify(keyword.keyword).slice(0, 255);
            const pageId = await this.upsertPage(client, {
                websiteId: website.id,
                keyword,
                content,
                parentCategory,
                categoryId,
                pageSlug,
            });

            await this.replacePageProducts(client, pageId, rows);

            let keywordMarkedProcessed = false;
            if (keyword.id && !dryRun) {
                await client.query("update keywords set processed_at = now() where id = $1", [keyword.id]);
                keywordMarkedProcessed = true;
            }

            return {
                slug: pageSlug,
                pageId,
                productsInserted: inserted,
                productsUpdated: updated,
                skipped,
                keywordMarkedProcessed,
                rolledBack: dryRun,
            };
        }, { rollback: dryRun });
    }

    private async upsertCategory(client: PoolClient, name: string): Promise<string> {
        const { rows } = await client.query<{ id: string }>(
            `insert into categories (name) values ($1)
             on conflict (name) do update set updated_at = now()
             returning id`,
            [name],
        );
        return rows[0].id;
    }

    private async upsertProducts(
        client: PoolClient,
        items: PageProduct[],
        scrapedProducts: Map<string, Product>,
        categoryId: string,
        trackingId: string,
    ) {
        const rows: { productId: string; enhancedTitle: string; keyFeatures: string[] }[] = [];
        const skipped: string[] = [];
        let inserted = 0;
        let updated = 0;

        for (const item of items) {
            const scraped = scrapedProducts.get(item.asin);
            if (!scraped) {
                skipped.push(`${item.asin} (no scraped file)`);
                continue;
            }

            try {
                const columns = this.mapper.toColumns(scraped, trackingId);
                const { rows: saved } = await client.query<{ id: string; inserted: boolean }>(
                    UPSERT_PRODUCT,
                    [
                        categoryId,
                        columns.asin,
                        columns.title,
                        columns.brand,
                        columns.price,
                        columns.currency,
                        columns.imageUrl,
                        columns.rating,
                        columns.reviewCount,
                        columns.features,
                        columns.specifications,
                        columns.description,
                        columns.affiliateUrl,
                        columns.isAvailable,
                        columns.lastFetchedAt,
                    ],
                );

                saved[0].inserted ? inserted++ : updated++;
                rows.push({
                    productId: saved[0].id,
                    enhancedTitle: item.enhanced_title,
                    keyFeatures: item.key_features,
                });
            } catch (error) {
                skipped.push(`${item.asin} (${(error as Error).message})`);
            }
        }

        return { rows, skipped, inserted, updated };
    }

    private async upsertPage(
        client: PoolClient,
        input: {
            websiteId: string;
            keyword: KeywordRow;
            content: PageContent;
            parentCategory: string;
            categoryId: string;
            pageSlug: string;
        },
    ): Promise<string> {
        const { websiteId, keyword, content, parentCategory, categoryId, pageSlug } = input;

        const values = [
            pageSlug,
            parentCategory,
            content.page_title.slice(0, 500),
            content.meta_description,
            content.h1_title.slice(0, 500),
            content.introduction,
            content.conclusion,
            JSON.stringify(content.buying_guide),
            JSON.stringify(content.faq),
            categoryId,
            keyword.id,
        ];

        const existing = keyword.id
            ? await client.query<{ id: string }>(
                  "select id from pages where website_id = $1 and keyword_id = $2",
                  [websiteId, keyword.id],
              )
            : { rows: [] as { id: string }[] };

        if (existing.rows.length) {
            const { rows } = await client.query<{ id: string }>(
                `update pages set
                    slug = $2, parent_category = $3, page_title = $4, meta_description = $5,
                    h1_title = $6, introduction = $7, conclusion = $8, buying_guide = $9,
                    faq = $10, category_id = $11, is_active = true, updated_at = now()
                 where id = $1
                 returning id`,
                [existing.rows[0].id, ...values.slice(0, 10)],
            );
            return rows[0].id;
        }

        const { rows } = await client.query<{ id: string }>(
            `insert into pages (
                website_id, slug, parent_category, page_title, meta_description, h1_title,
                introduction, conclusion, buying_guide, faq, category_id, keyword_id
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             on conflict (website_id, slug) do update set
                parent_category = excluded.parent_category, page_title = excluded.page_title,
                meta_description = excluded.meta_description, h1_title = excluded.h1_title,
                introduction = excluded.introduction, conclusion = excluded.conclusion,
                buying_guide = excluded.buying_guide, faq = excluded.faq,
                category_id = excluded.category_id, keyword_id = excluded.keyword_id,
                is_active = true, updated_at = now()
             returning id`,
            [websiteId, ...values],
        );
        return rows[0].id;
    }

    private async replacePageProducts(
        client: PoolClient,
        pageId: string,
        rows: { productId: string; enhancedTitle: string; keyFeatures: string[] }[],
    ): Promise<void> {
        await client.query("delete from page_products where page_id = $1", [pageId]);

        for (const [index, row] of rows.entries()) {
            await client.query(
                `insert into page_products (page_id, product_id, rank, enhanced_title, key_features)
                 values ($1,$2,$3,$4,$5)`,
                [pageId, row.productId, index + 1, row.enhancedTitle, JSON.stringify(row.keyFeatures)],
            );
        }
    }
}
