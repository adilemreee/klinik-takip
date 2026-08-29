# syntax=docker/dockerfile:1

# ---------- deps: full dependency tree for building ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: prisma client + typescript -> dist ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Fail the build here, not at container start, if the emitted layout shifts.
RUN npx prisma generate \
 && npm run build \
 && test -f dist/main.js \
 && test -f dist/worker.js

# ---------- migrate: one-shot, runs before the API starts ----------
# Reuses the build stage because it still has devDependencies, and the Prisma
# CLI is one of them. Keeping it out of the runtime image means the running API
# cannot alter the schema.
FROM build AS migrate
WORKDIR /app
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ---------- runtime: production deps only, non-root ----------
FROM node:22-alpine AS runtime
WORKDIR /app

# tesseract and poppler are the OCR stage (spec M16). Installed in the runtime
# image because the API and the worker share it: the worker is the only process
# that shells out to them, but splitting the image to save ~90 MB would mean two
# images to build, scan and keep in step.
#
# Both language files are needed: reports arrive in the patient's language and
# the clinic reads them in its own.
RUN apk add --no-cache \
    openssl \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-tur \
    poppler-utils
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Generated Prisma client and query engine from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# node:22-alpine ships an unprivileged `node` user. Never run as root — this
# process handles special-category health data (spec section 8).
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
