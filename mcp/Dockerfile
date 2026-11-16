FROM node:20-slim

WORKDIR /app

# Copiamos package.json primero para aprovechar caché de capas
COPY package*.json ./
RUN npm ci --only=production

# Código fuente
COPY src ./src

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/index.js"]
