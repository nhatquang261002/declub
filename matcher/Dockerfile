FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# The pool's sqlite file lives on a mounted volume, so a redeploy keeps the book and the bans.
# Runs as root because a hosted volume is mounted root-owned; the container holds only the gas key.
ENV MATCHER_HOST=0.0.0.0 \
    MATCHER_DB_PATH=/data/pool.sqlite
CMD ["node", "src/main.ts"]
