# ---- build stage ----------------------------------------------------------
FROM node:26-alpine AS build
RUN apk upgrade --no-cache && apk add --no-cache --upgrade 'zlib>=1.4'
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime stage --------------------------------------------------------
# Folio processes documents on its own server. The native engines below are the
# actual processors; the Node process only orchestrates jobs and serves the SPA.
#
# Debian 13 (trixie, current stable) instead of Alpine: the distributor ships
# patched glib (2.84) and ImageMagick (7.1.1.43), which the image security scan
# still reports as vulnerable on Alpine v3.24 — that branch carries no newer
# build of either package, so no apk upgrade can clear those advisories.
FROM node:26-trixie-slim AS runtime

RUN apt-get update \
 && apt-get -y upgrade \
 && apt-get install -y --no-install-recommends \
      qpdf \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-osd \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-liberation \
      fonts-dejavu-core \
      imagemagick \
      ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY server.mjs ./server.mjs

# LibreOffice and Tesseract write profiles/temp data into $HOME.
ENV HOME=/home/node
ENV PORT=3000
ENV FOLIO_ROOT=/app/dist
ENV FOLIO_JOB_DIR=/tmp/folio-jobs
# A 1 GB / 1 vCPU app can only run one heavy native engine at a time.
ENV FOLIO_HEAVY_CONCURRENCY=1
ENV FOLIO_LIGHT_CONCURRENCY=2
ENV FOLIO_JOB_TIMEOUT_MS=180000
ENV FOLIO_ENGINE_TIMEOUT_MS=120000

EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
