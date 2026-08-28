import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";

const BLOCKED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);
const LOCATION_PROBE_URL = "https://www.amazon.com/s?k=amazon+basics";
const US_ADDRESS = /\b(US|USA|United States|\d{5})\b/i;

type Slot = { context: BrowserContext; page: Page };

export type DeliveryLocation = { address: string | null; isUnitedStates: boolean };

export class BrowserPool {
    private browser: Browser | null = null;
    private slots: Slot[] = [];
    private available: Slot[] = [];
    private waiting: ((slot: Slot) => void)[] = [];
    private startup: Promise<void> | null = null;
    private locationPinning: Promise<DeliveryLocation> | null = null;
    private closed = false;
    private location: DeliveryLocation = { address: null, isUnitedStates: false };

    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
    ) {}

    get deliveryLocation(): DeliveryLocation {
        return this.location;
    }

    async use<T>(work: (page: Page) => Promise<T>): Promise<T> {
        await this.start();
        await this.ensureLocationPinned();

        const slot = await this.acquire();
        try {
            return await work(slot.page);
        } finally {
            this.release(slot);
        }
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const slot of this.slots) await slot.context.close().catch(() => {});
        await this.browser?.close().catch(() => {});

        this.browser = null;
        this.slots = [];
        this.available = [];
        this.waiting = [];
        this.startup = null;
        this.locationPinning = null;
    }

    private async start(): Promise<void> {
        if (this.closed) throw new Error("browser pool is closed");
        if (this.browser) return;
        if (this.startup) return this.startup;

        this.startup = this.launch();

        try {
            await this.startup;
        } catch (error) {
            this.startup = null;
            await this.close().catch(() => {});
            this.closed = false;
            throw error;
        }
    }

    private async launch(): Promise<void> {
        this.browser = await chromium.launch({
            headless: this.config.headless,
            args: ["--disable-blink-features=AutomationControlled"],
            ...(this.config.proxy ? { proxy: { server: this.config.proxy } } : {}),
        });

        for (let index = 0; index < this.config.concurrency; index++) {
            const context = await this.browser.newContext({
                userAgent: this.config.userAgent,
                locale: "en-US",
                timezoneId: "America/New_York",
                viewport: { width: 1440, height: 900 },
            });

            await context.route("**/*", (route) =>
                BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
            );

            await context.addInitScript(() => {
                (globalThis as any).__name ??= (fn: unknown) => fn;
            });

            const page = await context.newPage();
            page.setDefaultTimeout(30_000);

            const slot = { context, page };
            this.slots.push(slot);
            this.available.push(slot);
        }
    }

    private acquire(): Promise<Slot> {
        const slot = this.available.pop();
        if (slot) return Promise.resolve(slot);
        return new Promise((resolve) => this.waiting.push(resolve));
    }

    private release(slot: Slot): void {
        const next = this.waiting.shift();
        if (next) next(slot);
        else this.available.push(slot);
    }

    private ensureLocationPinned(): Promise<DeliveryLocation> {
        return (this.locationPinning ??= this.pinDeliveryLocation());
    }

    private async pinDeliveryLocation(): Promise<DeliveryLocation> {
        const slot = await this.acquire();

        try {
            const { page, context } = slot;
            await page.goto(LOCATION_PROBE_URL, { waitUntil: "domcontentloaded" });

            const csrfToken = await page.evaluate(() => {
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

            if (csrfToken) {
                await page.evaluate(
                    async ([zip, token]) => {
                        await fetch("/portal-migration/hz/glow/address-change?actionSource=glow", {
                            method: "POST",
                            headers: {
                                "content-type": "application/json",
                                "anti-csrftoken-a2z": token as string,
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
                    [this.config.zip, csrfToken],
                );
                await page.goto(LOCATION_PROBE_URL, { waitUntil: "domcontentloaded" });
            }

            const address = await page.evaluate(
                () => document.querySelector("#glow-ingress-line2")?.textContent?.trim() ?? null,
            );

            this.location = { address, isUnitedStates: !!address && US_ADDRESS.test(address) };

            this.logger.info(`  delivering to: ${address ?? "unknown"}`, {
                delivery: address,
                isUnitedStates: this.location.isUnitedStates,
            });
            if (!this.location.isUnitedStates) {
                this.logger.warn(
                    "  ! not a US delivery address — prices and availability are localised." +
                        " set PROXY_SERVER to a US proxy for US pricing.",
                );
            }

            const cookies = await context.cookies();
            await Promise.all(
                this.slots
                    .filter((other) => other !== slot)
                    .map((other) => other.context.addCookies(cookies)),
            );
        } catch (error) {
            this.logger.warn(`  ! location pin failed: ${(error as Error).message.split("\n")[0]}`);
        } finally {
            this.release(slot);
        }

        return this.location;
    }
}
