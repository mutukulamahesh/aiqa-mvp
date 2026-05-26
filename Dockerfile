FROM node:20-slim

WORKDIR /app

# Install all dependencies (including devDeps — needed for the build step).
# Copying package files first keeps this layer cached across source-only changes.
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium + all system deps in one step.
# --with-deps handles the full OS dependency list; no manual apt-get list needed.
RUN npx playwright install chromium --with-deps

# Copy source before building — tsc needs src/ and tsconfig.json present.
COPY . .

# Compile TypeScript → dist/
RUN npm run build

# Prune dev dependencies after build (ts-node, typescript, etc. no longer needed).
# If runtime features stop working in the image, check that their packages
# haven't drifted into devDependencies by mistake.
RUN npm prune --omit=dev

RUN chown -R node:node /app

USER node

# Mount point for user test files
VOLUME ["/tests"]

ENTRYPOINT ["node", "bin/aiqa.js"]
CMD ["--help"]
