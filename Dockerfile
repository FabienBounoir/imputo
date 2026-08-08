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
RUN npm run build
# Stage "build" gardé tel quel (devDependencies + source complets) : cible réutilisable pour les
# scripts ponctuels (db:seed, db:unseed, db:studio…) qui ont besoin de tsx/drizzle-kit — voir le
# service `tools` de docker-compose.yml. Le prune n'arrive qu'à l'étape suivante.

FROM build AS pruned
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=pruned /app/build ./build
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/package.json ./package.json
COPY --from=pruned /app/drizzle ./drizzle
COPY --from=pruned /app/scripts/migrate.js ./scripts/migrate.js
EXPOSE 3000
ENV PORT=3000
CMD ["sh", "-c", "node scripts/migrate.js && node build"]
