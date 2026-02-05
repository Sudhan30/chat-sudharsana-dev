# ============================================
# chat.sudharsana.dev - Production Dockerfile
# Bun + Hono + PostgreSQL + Ollama
# ============================================

FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install --production

# Copy source
COPY src ./src
COPY tsconfig.json ./

# ============================================
# Production stage
# ============================================
FROM oven/bun:1-alpine AS runner
WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

USER appuser

# Environment variables (defaults, override in K8s)
ENV PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "run", "src/server.ts"]
