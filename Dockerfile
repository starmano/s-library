FROM node:22-alpine
WORKDIR /app
COPY package.json app.js CHANGELOG.md ./
COPY src ./src
COPY public ./public
COPY fonts ./fonts
ENV PORT=7000
EXPOSE 7000
USER node
CMD ["node", "app.js"]
