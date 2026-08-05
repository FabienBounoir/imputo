# Image de production portable (Docker / Kubernetes) — build avec adapter-node.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV BUILD_ADAPTER=node
# Jamais utilisée pour une vraie connexion (le client postgres est lazy) — seulement pour que
# l'analyse des routes au build ne plante pas sur `DATABASE_URL is not set`.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.js ./scripts/migrate.js
EXPOSE 3000
ENV PORT=3000
CMD ["sh", "-c", "node scripts/migrate.js && node build"]
