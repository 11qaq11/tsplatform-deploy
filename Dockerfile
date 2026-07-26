FROM node:20-alpine
WORKDIR /app
COPY packages/cloud-server/package.json ./
RUN npm install --production
COPY packages/cloud-server/src/ ./src/
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "src/index.js"]
