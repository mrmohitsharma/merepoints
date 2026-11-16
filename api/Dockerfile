# Vyapar Point API: build once, run anywhere (AWS App Runner, ECS, a VPS).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc -p . && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./
USER node
EXPOSE 8080
# Apply new migrations (safe with several servers: they take a lock), then start.
CMD ["sh", "-c", "node dist/src/db/migrate.js && node dist/src/main.js"]
