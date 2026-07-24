FROM node:20-slim

WORKDIR /app

COPY client/package*.json ./
RUN npm install

COPY client/ ./

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
