# ---- build stage ----------------------------------------------------------
FROM node:26-alpine AS build
RUN apk upgrade --no-cache
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime stage --------------------------------------------------------
# The app is a client-side SPA. The Node static server is used (instead of a
# generic static server) because the PDF.js worker is an ES module served as
# .mjs and must be returned with a JavaScript MIME type, plus gzip support.
FROM node:26-alpine AS runtime
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs

ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.mjs"]
