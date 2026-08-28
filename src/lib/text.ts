export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

export function parseLeadingNumber(text: string | null | undefined): number | null {
    if (!text) return null;
    const match = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return match ? Number.parseFloat(match[0]) : null;
}

export function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(baseMs: number): number {
    return baseMs + Math.random() * baseMs;
}
