FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.start.json vite.config.ts drizzle.config.ts ./
COPY drizzle/ drizzle/
COPY src/ src/
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY --from=build /app/.output/ .output/
COPY --from=build /app/drizzle/ drizzle/

EXPOSE 3000
CMD ["npm", "start"]
