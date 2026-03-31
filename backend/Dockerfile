FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
