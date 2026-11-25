FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Kolkata
ENV PORT=3001

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /data /app/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["npm", "start"]
