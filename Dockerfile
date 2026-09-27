# syntax=docker/dockerfile:1

# Imagen de Dungeon Copilot: el servidor con la web compilada, todo en el puerto 3000.
# Sin DATABASE_URL guarda los datos con PGlite en /data; para k3s, ver deploy/k3s.

# Se compila en la arquitectura de quien construye: el resultado es JavaScript y WebAssembly,
# que vale igual en amd64 que en arm64, así que la imagen de arm64 no necesita emulación.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /repo

# Primero solo los manifiestos: si no cambian las dependencias, la instalación sale de la caché.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/rules/package.json packages/rules/
COPY packages/shared/package.json packages/shared/
RUN npm install -g "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
  && pnpm --filter @dungeon-copilot/server deploy --prod --legacy /out/server \
  && cp -r apps/web/dist /out/web \
  && mkdir /out/data

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/data/pglite \
  WEB_DIST=/app/web
WORKDIR /app/server
COPY --from=build /out/server ./
COPY --from=build /out/web /app/web
COPY --from=build --chown=node:node /out/data /data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
