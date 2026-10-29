FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN chgrp -R 0 /app && chmod -R g=u /app
USER 1001
EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/server.js"]
