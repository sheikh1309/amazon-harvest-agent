export class RunArtifacts {
    private outputPathValue: string | null = null;
    private pageSlugValue: string | null = null;
    private pageIdValue: string | null = null;

    recordOutput(relativePath: string): void {
        this.outputPathValue = relativePath;
    }

    recordCommittedPage(slug: string, pageId: string): void {
        this.pageSlugValue = slug;
        this.pageIdValue = pageId;
    }

    get outputPath(): string | null {
        return this.outputPathValue;
    }

    get pageSlug(): string | null {
        return this.pageSlugValue;
    }

    get pageId(): string | null {
        return this.pageIdValue;
    }

    get pageWasCommitted(): boolean {
        return this.pageSlugValue !== null;
    }
}
