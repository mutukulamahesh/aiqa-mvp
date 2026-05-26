FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium + all system deps in one step
# --with-deps handles the full OS dependency list; no manual apt-get list needed
RUN npx playwright install chromium --with-deps

# Prune dev dependencies after browser install (playwright is in devDeps)
RUN npm prune --omit=dev

# Copy source and hand ownership to the non-root node user
COPY . .
RUN chown -R node:node /app

USER node

# Mount point for user test files
VOLUME ["/tests"]

ENTRYPOINT ["node", "bin/aiqa.js"]
CMD ["--help"]
