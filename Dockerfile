FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV PORT=7000
EXPOSE 7000
USER node
CMD ["node", "src/server.js"]
