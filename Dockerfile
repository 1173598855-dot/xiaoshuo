FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV XIAOYI_HOST=0.0.0.0
ENV PORT=4310
ENV XIAOYI_DATABASE_PATH=/var/lib/xiaoyi/xiaoyi.db
ENV XIAOYI_BACKUP_DIR=/var/lib/xiaoyi/backups
ENV XIAOYI_STATIC_DIR=/app/dist/client

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/client ./dist/client

RUN mkdir -p /var/lib/xiaoyi/backups \
  && chown -R node:node /app /var/lib/xiaoyi
USER node
VOLUME ["/var/lib/xiaoyi"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.PORT||'4310'; fetch('http://127.0.0.1:'+port+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
