import type { Page } from "playwright";
import type { BrowserPool } from "./browser-pool";
import { jitter, sleep } from "../lib/text";

const BACKOFF_BASE_MS = 1200;

export class PageBlockedError extends Error {
    constructor(reason: string) {
        super(`blocked (${reason})`);
        this.name = "PageBlockedError";
    }
}

export class PageNavigator {
    constructor(
        private readonly pool: BrowserPool,
        private readonly attempts = 3,
    ) {}

    async visit<T>(url: string, read: (page: Page) => Promise<T>): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.attempts; attempt++) {
            try {
                return await this.pool.use(async (page) => {
                    await page.goto(url, { waitUntil: "domcontentloaded" });

                    const reason = await PageNavigator.blockedReason(page);
                    if (reason) throw new PageBlockedError(reason);

                    return read(page);
                });
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.attempts - 1) await sleep(jitter(BACKOFF_BASE_MS * 2 ** attempt));
            }
        }

        throw lastError ?? new Error(`failed to load ${url}`);
    }

    private static blockedReason(page: Page): Promise<string | null> {
        return page.evaluate(() => {
            const body = document.body?.innerText ?? "";

            if (
                /Enter the characters you see below|Type the characters you see/i.test(body) ||
                document.querySelector("form[action*='validateCaptcha']")
            ) {
                return "captcha";
            }
            if (/Sorry, we just need to make sure you're not a robot/i.test(body)) return "bot check";
            if (/^\s*Sorry[!,]?\s*(Something went wrong|We couldn't find that page)/i.test(body)) {
                return "amazon error page";
            }
            if (body.trim().length < 200 && !document.querySelector("#productTitle, .s-main-slot")) {
                return "empty response";
            }
            return null;
        });
    }
}
