FROM node:20-slim

# Install g++ build tools for C++ Chess Engine
RUN apt-get update && apt-get install -y g++ make && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy C++ source and compile engine
COPY engine.cpp /app/engine.cpp
RUN g++ -O3 /app/engine.cpp -o /app/engine

# Copy backend dependencies and source
COPY server/package*.json /app/server/
WORKDIR /app/server
RUN npm install

COPY server/ /app/server/

ENV ENGINE_PATH=/app/engine
ENV PORT=5000
ENV OTEL_SERVICE_NAME=chess-engine-service
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

EXPOSE 5000

CMD ["npm", "start"]
