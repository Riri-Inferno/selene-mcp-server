# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# root で動かさない（node:alpine に用意されている node ユーザー）
USER node

# 既定は stdio（docker run -i で MCP クライアントから起動する使い方）。
# k3s などで HTTP として動かす場合は MCP_TRANSPORT=http を指定する（PORT の既定は 3000）。
EXPOSE 3000
CMD ["node", "dist/index.js"]
