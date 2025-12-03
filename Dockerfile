ARG VERSION=25.2.1

FROM node:${VERSION}-alpine AS base

# Install latest corepack to manage package managers
RUN npm install -g corepack@latest --force

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
FROM base AS dependencies

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM dependencies AS build

# Copy all files
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM base AS production

ARG ENV=production
ENV APP_ENV=${ENV}
ENV APP_PORT=4000
ENV APP_HOST=0.0.0.0

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built files from build stage
COPY --from=build /app/dist ./dist

# Expose application port
EXPOSE ${APP_PORT}

CMD ["node", "dist/main"]
