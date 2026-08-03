import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../lib/config";
import { sleep, jitter } from "../lib/amazon";

/** Subresources we never read. Blocking them is the single biggest page-load win. */
const BLOCKED = new Set(["image", "media", "font", "stylesheet"]);

type Slot = { context: BrowserContext; page: Page };

/**
 * One chromium process, N contexts, each holding one reusable page.
 *
 * Every scrape borrows a slot, so `concurrency` is a hard ceiling on simultaneous
 * requests to amazon no matter how many subagents are calling tools at once.
 */
class BrowserPool {
    private browser: Browser | null = null;
    private slots: Slot[] = [];
    private free: Slot[] = [];
    private waiting: ((slot: Slot) => void)[] = [];
    private starting: Promise<void> | null = null;
    private location_pinned = false;

    async start() {
        if (this.browser) return;
        if (this.starting) return this.starting;

        this.starting = (async () => {
            this.browser = await chromium.launch({
                headless: config.headless,
                args: ["--disable-blink-features=AutomationControlled"],
                ...(config.proxy ? { proxy: { server: config.proxy } } : {}),
            });

            for (let i = 0; i < config.concurrency; i++) {
                const context = await this.browser.newContext({
                    userAgent: config.user_agent,
                    locale: "en-US",
                    timezoneId: "America/New_York",
                    viewport: { width: 1440, height: 900 },
                });

                await context.route("**/*", (route) =>
                    BLOCKED.has(route.request().resourceType()) ? route.abort() : route.continue(),
                );

                // esbuild (tsx, dev mode) rewrites named functions to `__name(fn, "fn")`.
                // page.evaluate serializes that source verbatim, so the helper has to
                // exist in the page or every evaluate throws `__name is not defined`.
                await context.addInitScript(() => {
                    (globalThis as any).__name ??= (fn: unknown) => fn;
                });

                const page = await context.newPage();
                page.setDefaultTimeout(30_000);
                const slot = { context, page };
                this.slots.push(slot);
                this.free.push(slot);
            }
        })();

        await this.starting;
    }

    private acquire(): Promise<Slot> {
        const slot = this.free.pop();
        if (slot) return Promise.resolve(slot);
        return new Promise((resolve) => this.waiting.push(resolve));
    }

    private release(slot: Slot) {
        const next = this.waiting.shift();
        if (next) next(slot);
        else this.free.push(slot);
    }

    /** Borrow a page for the duration of `fn`. Always returns the slot, even on throw. */
    async use<T>(fn: (page: Page) => Promise<T>): Promise<T> {
        await this.start();
        await this.pin_location();
        const slot = await this.acquire();
        try {
            return await fn(slot.page);
        } finally {
            this.release(slot);
        }
    }

    /**
     * Set the delivery zip once, then share the resulting cookies with every context.
     *
     * Caveat worth knowing before you trust a price: amazon derives the delivery
     * *country* from the request IP, and the glow endpoint only moves the zip within
     * that country. Called from a non-US IP this returns 200 and changes nothing, so
     * we verify afterwards and say plainly which country we ended up in.
     */
    private async pin_location() {
        if (this.location_pinned) return;
        this.location_pinned = true;

        const slot = this.slots[0];
        if (!slot) return;

        // the homepage answers bots with an empty 202; a search page renders in full
        const probe = "https://www.amazon.com/s?k=amazon+basics";

        try {
            const page = slot.page;
            await page.goto(probe, { waitUntil: "domcontentloaded" });

            const token = await page.evaluate(() => {
                const raw = document
                    .querySelector("#nav-global-location-data-modal-action")
                    ?.getAttribute("data-a-modal");
                if (!raw) return null;
                try {
                    return JSON.parse(raw)?.ajaxHeaders?.["anti-csrftoken-a2z"] ?? null;
                } catch {
                    return null;
                }
            });

            if (token) {
                await page.evaluate(
                    async ([zip, csrf]) => {
                        await fetch("/portal-migration/hz/glow/address-change?actionSource=glow", {
                            method: "POST",
                            headers: {
                                "content-type": "application/json",
                                "anti-csrftoken-a2z": csrf as string,
                            },
                            body: JSON.stringify({
                                locationType: "LOCATION_INPUT",
                                zipCode: zip,
                                countryCode: "US",
                                deviceType: "web",
                                storeContext: "generic",
                                pageType: "Search",
                                actionSource: "glow",
                            }),
                        });
                    },
                    [config.zip, token],
                );
                await page.goto(probe, { waitUntil: "domcontentloaded" });
            }

            const where = await page.evaluate(
                () => document.querySelector("#glow-ingress-line2")?.textContent?.trim() ?? null,
            );

            const us = !!where && /\b(US|USA|United States|\d{5})\b/i.test(where);
            console.log(`  delivering to: ${where ?? "unknown"}`);
            if (!us) {
                console.warn(
                    `  ! not a US delivery address — prices and availability are localised.` +
                        ` set PROXY_SERVER to a US proxy for US pricing.`,
                );
            }

            const cookies = await slot.context.cookies();
            await Promise.all(this.slots.slice(1).map((s) => s.context.addCookies(cookies)));
        } catch (e) {
            console.warn(`  ! location pin failed: ${(e as Error).message.split("\n")[0]}`);
        }
    }

    async close() {
        for (const slot of this.slots) await slot.context.close().catch(() => {});
        await this.browser?.close().catch(() => {});
        this.browser = null;
        this.slots = [];
        this.free = [];
        this.starting = null;
        this.location_pinned = false;
    }
}

export const pool = new BrowserPool();

/**
 * Navigate + read, with backoff. Amazon answers a burst with 503s and captcha
 * interstitials rather than a hard block, so a retry usually clears it.
 */
export async function visit<T>(
    url: string,
    read: (page: Page) => Promise<T>,
    attempts = 3,
): Promise<T> {
    let last: Error | null = null;

    for (let i = 0; i < attempts; i++) {
        try {
            return await pool.use(async (page) => {
                await page.goto(url, { waitUntil: "domcontentloaded" });
                if (await is_blocked(page)) throw new Error("blocked (captcha or 503)");
                return read(page);
            });
        } catch (e) {
            last = e as Error;
            if (i < attempts - 1) await sleep(jitter(1200 * 2 ** i));
        }
    }

    throw last ?? new Error(`failed to load ${url}`);
}

async function is_blocked(page: Page) {
    return page.evaluate(() => {
        const body = document.body?.innerText ?? "";
        return (
            /Enter the characters you see below|Type the characters you see/i.test(body) ||
            !!document.querySelector("form[action*='validateCaptcha']")
        );
    });
}
