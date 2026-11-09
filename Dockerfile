# ---- build stage ----------------------------------------------------------
FROM node:26-alpine AS build
RUN apk upgrade --no-cache && apk add --no-cache --upgrade 'zlib>=1.4'
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime stage (application host) -------------------------------------
# Folio processes documents on its own server. This image carries the engines
# that fit the application host's 1 GB / 1 vCPU budget:
#
#   qpdf          -> merge, split, rotate, compress, repair, encrypt, decrypt
#   poppler-utils -> page rasterising (JPG/PNG), text extraction, redaction
#   tesseract-ocr -> OCR text layers
#
# The heavy Office/HTML renderer (LibreOffice) is NOT installed here. It needs
# roughly half a gigabyte of RAM on its own, so it runs as a separate worker
# tier built from Dockerfile.worker - see DEPLOYMENT.md. Tools that require it
# return an explicit ENGINE_MISSING error instead of producing bad output.
#
# ImageMagick is intentionally absent: no pipeline handler shells out to it
# (image -> PDF is done in-process with pdf-lib), and it is a large attack
# surface for no capability.
FROM node:26-alpine AS runtime
RUN apk upgrade --no-cache \
 && apk add --no-cache --upgrade 'zlib>=1.4' \
      qpdf \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      fontconfig \
      ttf-dejavu

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY server.mjs ./server.mjs

# Tesseract writes temp data into $HOME.
ENV HOME=/home/node
ENV PORT=3000
ENV FOLIO_ROOT=/app/dist
ENV FOLIO_JOB_DIR=/tmp/folio-jobs
# 1 GB / 1 vCPU: one Poppler or Tesseract job at a time, two light pdf-lib jobs.
ENV FOLIO_HEAVY_CONCURRENCY=1
ENV FOLIO_LIGHT_CONCURRENCY=2
ENV FOLIO_JOB_TIMEOUT_MS=180000
ENV FOLIO_ENGINE_TIMEOUT_MS=120000

EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
