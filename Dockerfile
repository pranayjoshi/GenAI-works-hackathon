# Ripple (Dry Run) submission image.
#   docker build -t oah-submission .
#   docker run --rm -p 8000:8000 --env-file .env oah-submission          # live models (see .env.example)
#   docker run --rm -p 8000:8000 -e SAMPLE_MODE=true oah-submission      # no credentials: recorded replay + offline persona model
#
# From inside the container the host services are NOT at localhost. Point at them with env overrides, e.g.
#   NIGHTSHIFT_BASE_URL=http://host.docker.internal:8088/v1  ZETARIS_BASE_URL=http://host.docker.internal:<port>
#   OLLAMA_BASE_URL=http://host.docker.internal:11434
# Nothing is downloaded at startup; Census rows for the example ZIPs are in data/cache, other ZIPs are fetched on
# demand from Census Reporter and fall back to the national row (with a note) when offline.
FROM node:20-slim
WORKDIR /app
ENV PORT=8000 HOST=0.0.0.0 SAMPLE_MODE=false
COPY package.json package-lock.json ./
# tsx is a devDependency but runs the app, so install everything; better-sqlite3 and duckdb ship prebuilt binaries
RUN npm ci --no-audit --no-fund
COPY . .
RUN mkdir -p runs logs
EXPOSE 8000
CMD ["npx", "tsx", "src/api.ts"]
