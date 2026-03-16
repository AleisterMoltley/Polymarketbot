# Optimized Dockerfile for Polymarket Trading Bot
# Multi-stage build for faster image builds and smaller final image

# Stage 1: Install dependencies
FROM node:18-alpine AS deps
WORKDIR /app
# Install only production dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production && \
    cp -R node_modules prod_node_modules && \
    npm ci

# Stage 2: Build TypeScript
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production image
FROM node:18-alpine AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 botuser

# Copy only what's needed for production
COPY --from=deps /app/prod_node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/wallet.js ./wallet.js
COPY --from=builder /app/ok.js ./ok.js
COPY package.json ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R botuser:nodejs /app

# Switch to non-root user
USER botuser

# Expose port
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node ok.js || exit 1

# Environment variables optimized for 5-minute interval trading
ENV NODE_ENV=production
ENV PORT=3000
ENV PAPER_TRADE=true
ENV POLL_INTERVAL_MS=300000

# Start the bot
CMD ["node", "dist/index.js"]
