import "dotenv/config";

const num = (v: string | undefined, fallback: number) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
};

export const config = {
    affiliate_tag: process.env.AFFILIATE_TAG ?? "best10deals-20",

    // Deliberately not MODEL_NAME — that key already exists in .env pointing at a
    // non-anthropic model, and silently inheriting it produces a 404 at run time.
    /** main agent + curator: reasoning-heavy, keep it on the strongest model */
    model: process.env.AGENT_MODEL ?? "inclusionai/ling-2.6-flash:floor",

    /** how many browser contexts scrape in parallel. >6 from one IP gets you captcha'd */
    concurrency: num(process.env.CONCURRENCY, 6),
    headless: process.env.HEADFUL !== "1",

    /**
     * US zip used to pin prices + availability.
     *
     * Amazon resolves the delivery *country* from the request IP and only lets the
     * glow endpoint change the zip within that country. From a non-US IP you will
     * get non-US prices no matter what this is set to — route through a US proxy
     * (PROXY_SERVER) if the price field has to be trustworthy.
     */
    zip: process.env.AMAZON_ZIP ?? "10001",

    /** e.g. http://user:pass@us-proxy.example.com:8080 */
    proxy: process.env.PROXY_SERVER || null,

    max_pages: num(process.env.MAX_PAGES, 3),
    candidate_count: num(process.env.CANDIDATE_COUNT, 30),
    final_count: num(process.env.FINAL_COUNT, 10),
    min_rating: num(process.env.MIN_RATING, 4.0),
    min_reviews: num(process.env.MIN_REVIEWS, 100),

    /** agent filesystem root — subagents hand each other file paths, not payloads */
    workspace: process.env.WORKSPACE ?? "workspace",
    output_dir: process.env.OUTPUT_DIR ?? "output",

    user_agent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

export type config = typeof config;
