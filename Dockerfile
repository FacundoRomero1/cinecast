FROM node:22-slim

WORKDIR /app

# git requerido para dependencias github:* (ej. vidsrc-utils); no instalamos electron ni playwright
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_OPTIONS="--max-old-space-size=384"

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --omit=optional --legacy-peer-deps --no-audit --no-fund && npm install -g tsx

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV CINECAST_DISABLE_PREWARM=1

EXPOSE 3000

CMD ["tsx", "server.ts"]
