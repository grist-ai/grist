# Grist gateway image (v2 layout).
#
# Build stage bundles the gateway + @grist-ai/logic into one file with
# `bun build --target=bun` (bun:sqlite stays external — it's a Bun runtime
# builtin). The runtime image therefore needs no node_modules at all.
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY packages/grist-gateway ./packages/grist-gateway
COPY packages/grist-logic ./packages/grist-logic
# site/grist-skill.md is a symlink to the canonical skills/grist/SKILL.md in
# the repo; materialize the real file here (COPY through a dangling symlink
# is not portable across builders).
RUN rm ./packages/grist-gateway/site/grist-skill.md
COPY skills/grist/SKILL.md ./packages/grist-gateway/site/grist-skill.md
# Minimal workspace link so the bundler can resolve @grist-ai/logic.
RUN mkdir -p packages/grist-gateway/node_modules/@grist-ai \
  && ln -s ../../../grist-logic packages/grist-gateway/node_modules/@grist-ai/logic \
  && cd packages/grist-gateway \
  && bun build src/entry.ts --target=bun --outfile=dist/gateway.js
# NOTE: the bundle resolves its site/ dir as <bundle-dir>/../site
# (import.meta.dir + ".."), so site/ lands at /app/site below.

# Runtime stage: the gateway never runs as root. The entrypoint starts as root
# only to chown /data (a Railway volume mount masks the build-time chown, so it
# must happen at container start), then drops to the grist user via su-exec.
# HEALTHCHECK lets Railway restart a wedged gateway.
FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=build /app/packages/grist-gateway/dist ./dist
COPY --from=build /app/packages/grist-gateway/site ./site
COPY packages/grist-gateway/entrypoint.sh ./entrypoint.sh
ENV NODE_ENV=production
ENV GRIST_GATEWAY_DB=/data/grist-gateway.sqlite
EXPOSE 8787
RUN apk add --no-cache su-exec \
  && addgroup -S grist && adduser -S grist -G grist && chown -R grist:grist /app \
  && mkdir -p /data && chown grist:grist /data \
  && chmod +x ./entrypoint.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:8787/health"); if (!r.ok) process.exit(1)'
ENTRYPOINT ["/app/entrypoint.sh"]
