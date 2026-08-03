import 'dotenv/config';
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { write_products, type product } from "./tools/write_products";
// $2.55
const AFFILIATE_TAG = "best10deals-20";
const KEYWORD = process.argv[2] ?? "grill";
const CANDIDATE_COUNT = 30;
const MAX_PAGES = 3;
const FINAL_COUNT = 10;
const MIN_RATING = 4.0;
const MIN_REVIEWS = 100;

function create_client() {
    return new MultiServerMCPClient({
        playwright: {
            transport: "stdio",
            command: "./node_modules/.bin/playwright-mcp",
            args: [
                "--browser", "chromium",
                "--headless",
                "--user-agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
            ],
        },
    });
}

function get_tool(tools: any[], name: string) {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`missing mcp tool: ${name}`);
    return t;
}

function parse_result(raw: string) {
    const lines = raw.split("\n");
    const start = lines.findIndex((l) => /^###\s*Result/i.test(l));
    const rest = start === -1 ? lines : lines.slice(start + 1);
    const end = rest.findIndex((l) => /^###\s/.test(l));
    const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`could not parse evaluate result:\n${raw.slice(0, 400)}`);
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base + Math.random() * base;

function full_res(url: string) {
    return url.replace(/\._[A-Z0-9_,\-]+_\./, ".");
}

function to_affiliate(asin: string) {
    return `https://www.amazon.com/dp/${asin}?tag=${AFFILIATE_TAG}`;
}

function score(p: product) {
    return (p.rating ?? 0) * Math.log10((p.review_count ?? 0) + 1);
}

function dedup_key(p: product) {
    return (p.title ?? "")
        .toLowerCase()
        .replace(/[®™]/g, "")
        .replace(/,.*$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

const DISCOVER_FN = `() => {
    const cards = [...document.querySelectorAll("div[data-component-type='s-search-result']")];
    return cards
        .filter(c => !/Sponsored/i.test(c.querySelector(".puis-sponsored-label-text")?.textContent || ""))
        .map(c => c.getAttribute("data-asin"))
        .filter(a => a && a.length === 10);
}`;

const EXTRACT_FN = `() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const num = (s) => {
        if (!s) return null;
        const m = s.replace(/,/g, "").match(/[\\d.]+/);
        return m ? parseFloat(m[0]) : null;
    };

    const bullets = [...document.querySelectorAll("#feature-bullets li span.a-list-item")]
        .map(el => el.textContent.trim())
        .filter(Boolean);

    const price_text = text("#corePrice_feature_div .a-price .a-offscreen")
        || text(".a-price .a-offscreen");
    const list_text = text(".basisPrice .a-offscreen")
        || text("span[data-a-strike='true'] .a-offscreen");

    let gallery = {};
    try {
        gallery = JSON.parse(document.querySelector("#landingImage")?.getAttribute("data-a-dynamic-image") || "{}");
    } catch (e) {}

    const primary = Object.keys(gallery).sort((a, b) => (gallery[b][0] || 0) - (gallery[a][0] || 0))[0] || null;

    const alts = [...document.querySelectorAll("#altImages img")]
        .map(img => img.getAttribute("src"))
        .filter(src => src && !/play-button|sprite|transparent-pixel/i.test(src));

    let variants = [];
    try {
        const swatches = [...document.querySelectorAll("#twister li[data-defaultasin], #twisterContainer li[data-defaultasin]")];
        variants = swatches.map(li => ({
            asin: li.getAttribute("data-defaultasin"),
            label: li.querySelector("img")?.getAttribute("alt")
                || li.textContent.trim().split("\\n")[0]
                || null,
            selected: li.classList.contains("swatchSelect"),
        })).filter(v => v.asin);
    } catch (e) {}

    if (!variants.length) {
        try {
            const script = [...document.querySelectorAll("script")]
                .map(s => s.textContent)
                .find(t => t && t.includes("dimensionToAsinMap"));
            const map = JSON.parse(script.match(/"dimensionToAsinMap"\\s*:\\s*(\\{[^}]*\\})/)[1]);
            variants = Object.values(map).map(asin => ({ asin, label: null, selected: false }));
        } catch (e) {}
    }

    return {
        title: text("#productTitle"),
        brand: text("#bylineInfo"),
        description: bullets.join(" "),
        price_text,
        list_text,
        rating: num(document.querySelector("#acrPopover")?.getAttribute("title") || text("#acrPopover .a-icon-alt")),
        review_count: num(text("#acrCustomerReviewText")),
        availability: text("#availability span"),
        is_prime: !!document.querySelector("#isPrimeBadge, #primeSaving_feature_div .a-icon-prime, .a-icon-prime"),
        coupon: text("#couponBadgeRegularVpc, #promoPriceBlockMessage_feature_div, .couponLabelText"),
        primary,
        alts,
        variants,
    };
}`;

async function discover(navigate: any, evaluate: any) {
    const asins: string[] = [];

    for (let page = 1; asins.length < CANDIDATE_COUNT && page <= MAX_PAGES; page++) {
        const url = `https://www.amazon.com/s?k=${encodeURIComponent(KEYWORD)}&page=${page}`;
        await navigate.invoke({ url });
        await sleep(jitter(1500));

        const found: string[] = parse_result(await evaluate.invoke({ function: DISCOVER_FN }));
        console.log(`  page ${page}: ${found.length} organic`);

        if (!found.length) break;
        asins.push(...found);
    }

    return [...new Set(asins)].slice(0, CANDIDATE_COUNT);
}

async function extract_one(navigate: any, evaluate: any, asin: string): Promise<product | null> {
    const url = `https://www.amazon.com/dp/${asin}`;
    await navigate.invoke({ url });
    await sleep(jitter(1200));

    const raw = await evaluate.invoke({ function: EXTRACT_FN });
    const d = parse_result(raw);

    if (!d.title) return null;

    const currency_match = (d.price_text || "").match(/[^\d.,\s]+/);
    const to_num = (s: string | null) => (s ? parseFloat(s.replace(/[^\d.]/g, "")) || null : null);

    const images = [
        ...(d.primary ? [{ url: full_res(d.primary), is_primary: true }] : []),
        ...d.alts.map((u: string) => ({ url: full_res(u), is_primary: false })),
    ];

    const seen_images = new Set<string>();
    const unique_images = images.filter((i) => !seen_images.has(i.url) && seen_images.add(i.url));

    return {
        asin,
        url,
        affiliate_url: to_affiliate(asin),
        title: d.title,
        brand: d.brand,
        description: d.description || null,
        price: to_num(d.price_text),
        currency: currency_match ? currency_match[0] : null,
        list_price: to_num(d.list_text),
        rating: d.rating,
        review_count: d.review_count,
        availability: d.availability,
        is_prime: !!d.is_prime,
        coupon: d.coupon,
        images: unique_images,
        scraped_at: new Date().toISOString(),
        variants: (d.variants ?? [])
            .filter((v: any) => v.asin !== asin)
            .map((v: any) => ({
                asin: v.asin,
                label: v.label,
                url: to_affiliate(v.asin),
            })),
    };
}

async function main() {
    const client = create_client();

    try {
        const tools = await client.getTools();
        const navigate = get_tool(tools, "browser_navigate");
        const evaluate = get_tool(tools, "browser_evaluate");

        console.log(`keyword: ${KEYWORD}`);

        const asins = await discover(navigate, evaluate);
        console.log(`discovered ${asins.length} organic asins\n`);

        const products: product[] = [];

        for (const asin of asins) {
            try {
                const p = await extract_one(navigate, evaluate, asin);
                if (p) {
                    products.push(p);
                    const v = p.variants.length ? `  +${p.variants.length} variants` : "";
                    console.log(`  ✓ ${asin}  ${p.rating ?? "-"}★ ${p.review_count ?? "-"} rev  ${p.price ?? "-"}${v}`);
                } else {
                    console.log(`  ✗ ${asin}  no title (blocked or layout change)`);
                }
            } catch (e) {
                console.log(`  ✗ ${asin}  ${(e as Error).message.split("\n")[0]}`);
            }
            await sleep(jitter(2000));
        }

        const seen_titles = new Set<string>();
        const ranked = products
            .filter((p) => (p.rating ?? 0) >= MIN_RATING && (p.review_count ?? 0) >= MIN_REVIEWS)
            .sort((a, b) => score(b) - score(a))
            .filter((p) => !seen_titles.has(dedup_key(p)) && seen_titles.add(dedup_key(p)))
            .slice(0, FINAL_COUNT);

        console.log(`\n${products.length} extracted → ${ranked.length} after filter + dedup\n`);

        for (const p of ranked) {
            console.log(`${score(p).toFixed(2)}  ${p.rating}★ (${p.review_count})  ${p.price ?? "?"}  ${p.title?.slice(0, 60)}`);
        }

        const message = await write_products({
            keyword: KEYWORD,
            tag: AFFILIATE_TAG,
            products: ranked,
            path: null,
        });

        console.log(`\n${message}`);
    } finally {
        await client.close();
    }
}

main().catch(console.error);