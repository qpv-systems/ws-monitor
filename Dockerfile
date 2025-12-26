# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock* ./

# Install dependencies
RUN npm ci || yarn install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY frontend ./frontend

RUN npm run build

FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock* ./

# Install production dependencies only
RUN npm ci --only=production || yarn install --frozen-lockfile --production=true

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/frontend ./frontend

# Expose port
EXPOSE 8000

# Start application
CMD ["node", "dist/proxy.js"]

