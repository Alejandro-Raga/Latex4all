FROM node:22-alpine
WORKDIR /app
COPY package.json relay.mjs storage.mjs ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
USER node
ENV HOST=0.0.0.0 PORT=8082 DATA_DIR=/data
EXPOSE 8082
CMD ["node", "relay.mjs"]
