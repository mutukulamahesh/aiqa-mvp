FROM node:20-slim

WORKDIR /app

# Install all dependencies (including devDeps — needed for the build step)
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium + all system deps in one step
# --with-deps handles the full OS dependency list; no manual apt-get list needed
RUN npx playwright install chromium --with-deps

# Compile TypeScript source to dist/ before pruning devDeps
RUN npm run build

# Prune dev dependencies after build (ts-node, typescript, etc. no longer needed).
# If runtime features stop working in the image, check that their packages
# haven't drifted into devDependencies by mistake.
RUN npm prune --omit=dev

# Copy source and hand ownership to the non-root node user.
# dist/ is excluded from the build context (portal/dist in .dockerignore) but
# already exists in the container from the build step above — COPY . . is safe.
COPY . .
RUN chown -R node:node /app

USER node

# Mount point for user test files
VOLUME ["/tests"]

ENTRYPOINT ["node", "bin/aiqa.js"]
CMD ["--help"]
