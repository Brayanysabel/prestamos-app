# Railway build: context is the repo root
FROM node:18-alpine

WORKDIR /app

# Install dependencies from root package.json (node_modules excluded by .dockerignore)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the whole repo (server/, server/www/, etc.)
COPY . .

ENV NODE_ENV=production

EXPOSE 8080

# Railway injects PORT; server.js binds to it automatically
CMD ["node", "server.js"]
