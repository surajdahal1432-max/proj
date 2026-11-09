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
#   qpdf          -> merge, split, rotate, compress, repair, encrypt, decrypt
#   poppler-utils -> page rasterising (JPG/PNG), text extraction, redaction
#   tesseract-ocr -> OCR text layers
#   libreoffice-* -> Word/Excel/PowerPoint/HTML/Markdown/webpage -> PDF
#
# Known platform gate: the image scanner reports ALPINE-CVE-2021-27219 against
# glib with "fixed 2.66.6-r0", while Alpine v3.24 ships 2.88.1-r1 - i.e. the
# installed build is newer than the listed fix, so no upgrade can satisfy it.
# glib arrives through poppler (verified: a build without LibreOffice and
# ImageMagick still reported it), and poppler is required for every PDF
# rasterising, text-extraction and OCR path, so no image layout avoids it.
# See DEPLOYMENT.md, "Base image decision".
FROM node:26-alpine AS runtime
RUN apk upgrade --no-cache \
 && apk add --no-cache --upgrade 'zlib>=1.4' \
      qpdf \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fontconfig \
      ttf-liberation \
      ttf-dejavu

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
