FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/worker ./src/worker
COPY src/guard ./src/guard

CMD ["node", "--import", "tsx", "src/worker/index.ts"]
