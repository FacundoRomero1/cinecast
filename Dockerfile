FROM node:22-slim

WORKDIR /app

# Dependencias del sistema mínimas para better-sqlite3 si hace falta compilar
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=optional || npm install --omit=optional

COPY . .

# Compilar frontend para servirlo en modo producción
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV CINECAST_DISABLE_PREWARM=1

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
