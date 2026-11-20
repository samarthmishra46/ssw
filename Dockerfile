# One image, two roles (docs/04):
#   web:    node apps/web/server.js         (Next.js standalone, port 3000)
#   worker: node apps/worker/dist/index.js  (queue consumer)
#   migrate: node packages/db/migrate.js    (run as a one-off ECS task before each deploy)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/content/package.json packages/content/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/funnel/package.json packages/funnel/
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @ssw/web \
 && npm run build -w @ssw/worker \
 && npx esbuild packages/db/src/migrate.ts --bundle --platform=node --format=esm --target=node22 \
      --outfile=build/migrate.js --packages=external

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    MIGRATIONS_DIR=/app/packages/db/drizzle
RUN addgroup -S app && adduser -S app -G app
# Next.js standalone output (includes the node_modules it traced)
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# Worker + migrations: bundled code, plus the npm packages they import
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/build/migrate.js ./packages/db/migrate.js
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=deps /app/node_modules ./node_modules
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
