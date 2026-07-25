FROM node:20-slim

WORKDIR /app

COPY coach/package*.json ./
RUN npm install

COPY coach/ ./

ENV PORT=5001
ENV OTEL_SERVICE_NAME=chess-coach-agent

EXPOSE 5001

CMD ["npm", "start"]
