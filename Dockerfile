FROM node:22-alpine
WORKDIR /app
COPY package.json app.js ./
COPY src ./src
COPY public ./public
ENV PORT=7000
EXPOSE 7000
USER node
CMD ["node", "app.js"]
