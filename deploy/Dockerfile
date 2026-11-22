# Production image (NOTE: not built/tested in the development environment — no Docker daemon there).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
RUN useradd -r -u 1001 coms && mkdir -p /data/uploads && chown -R coms /data /app/.next
USER coms
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npx next start -p 3000"]
