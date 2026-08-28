# The playwright image, pinned to the same version as the playwright dependency.
#
# Chromium's system libraries are the reason: `pnpm exec playwright install chromium`
# on a plain node image pulls a browser whose shared-library expectations do not match
# the base, and it fails at launch rather than at build time. A mismatch between this
# tag and the version in package.json produces the same class of failure, so they move
# together.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/bin \
    # the browsers the base image ships are already here; do not re-download them
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Dependencies as their own layer: the lockfile changes far less often than src/, so a
# code-only change reuses the installed store instead of resolving 200 packages again.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests

# Plain .sql that tsc does not emit, so it has to be copied rather than built. Without
# it `pnpm run migrate` in a container dies on ENOENT — loud, but only at deploy time.
COPY migrations ./migrations

# Fail the build rather than the deploy. Both are seconds and neither needs a database.
RUN pnpm run typecheck && pnpm run test

RUN pnpm run build && pnpm prune --prod

# Chromium sandboxing needs either a privileged container or a non-root user; the base
# image ships `pwuser` for exactly this. Running the browser as root is the other way
# and it is the one that ends up disabling the sandbox.
USER pwuser

# The workspace is scratch space — each run clears its own directory once the payload
# is recorded in postgres. A volume here only matters if you set KEEP_WORKSPACE=1.
VOLUME ["/app/workspace"]

# One keyword per invocation. The process claims a keyword, harvests it, records the
# run and exits: restarts are the scheduling mechanism, which is what makes this safe
# on spot capacity and under a Kubernetes Job or a plain `while true` loop.
#
# Exit codes: 0 success · 1 failed · 2 misconfigured · 3 queue empty.
ENTRYPOINT ["node", "dist/index.js"]
