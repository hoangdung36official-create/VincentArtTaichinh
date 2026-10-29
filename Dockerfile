FROM node:24-alpine

WORKDIR /app

# Copy application files
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV VINCENT_DATA_DIR=/app/data
ENV ADMIN_EMAIL=admin@vincent.local
ENV ADMIN_PASSWORD=Admin@Vincent2026!

EXPOSE 3000

# Verify syntax on build
RUN node --check src/server.js

CMD ["node", "src/server.js"]
