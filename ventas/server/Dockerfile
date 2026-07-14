FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server/ ./server/
COPY www/ ./www/
EXPOSE 8080
CMD ["node", "server/server.js"]
