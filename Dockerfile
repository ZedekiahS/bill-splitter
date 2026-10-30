FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=2801 TZ=Asia/Shanghai
EXPOSE 2801
CMD ["node", "server/start.mjs"]
