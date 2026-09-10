# syntax=docker/dockerfile:1
# Multi-stage build: compile in one stage, ship only the built application and
# its production dependencies in a plain node:24-alpine runtime (no compiler,
# no source, no dev dependencies). SQLite comes from Node's built-in module
# (decision D2), so no native build tooling is needed.

FROM node:24-alpine AS build
WORKDIR /src
RUN npm install -g pnpm@10.33.0

# Install dependencies first so this layer is cached until manifests change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/parser/package.json packages/parser/
COPY packages/app/package.json packages/app/
COPY packages/extension/package.json packages/extension/
RUN pnpm install --frozen-lockfile

# BUILD_ID is only used to force a fresh build of the application layers
# (the persistence check passes a new value to simulate a code change).
ARG BUILD_ID=dev
COPY packages ./packages
RUN echo "build ${BUILD_ID}" \
 && pnpm --filter @breadcrumb/parser build \
 && pnpm --filter @breadcrumb/app build \
 && pnpm --filter @breadcrumb/app deploy --legacy --prod /out

FROM node:24-alpine
ARG BUILD_ID=dev
LABEL org.opencontainers.image.title="BreadCrumb" \
      org.opencontainers.image.source="https://github.com/TimHayward/BreadCrumb" \
      breadcrumb.build_id="${BUILD_ID}"
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/breadcrumb.sqlite
WORKDIR /app
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
