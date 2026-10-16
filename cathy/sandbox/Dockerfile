# Cathy's box: one per chat. Everything is baked in so waking up is just "git fetch".
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep gh curl \
 && rm -rf /var/lib/apt/lists/*

RUN git config --system user.name "Cathy" \
 && git config --system user.email "cathy@withchris.uk" \
 && git config --system --add safe.directory /workspace

# A recent copy of the repo with dependencies installed. The box fetches the latest on wake.
RUN git clone --depth 50 https://github.com/ChrisMillerpy/chrismiller /workspace \
 && cd /workspace && npm ci --no-audit --no-fund

WORKDIR /workspace
CMD ["sleep", "infinity"]
