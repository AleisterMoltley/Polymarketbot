# Optimized Dockerfile for Polymarket Trading Bot
# Multi-stage build for lightweight 5-min trading bot

# Stage 1: Install all dependencies and build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Lightweight production image
FROM node:22-alpine AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botuser

# Copy only essential files for 5-min trading bot
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY ok.js ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R botuser:nodejs /app

# Switch to non-root user
USER botuser

# Expose port
EXPOSE 3000

# Health check aligned with 5-minute trading interval
HEALTHCHECK --interval=5m --timeout=10s --start-period=10s --retries=3 \
    CMD node ok.js || exit 1

# Environment variables optimized for 5-minute interval trading
ENV NODE_ENV=production
ENV PORT=3000
ENV PAPER_TRADE=true
ENV POLL_INTERVAL_MS=300000

# Start the bot
CMD ["node", "dist/index.js"]
