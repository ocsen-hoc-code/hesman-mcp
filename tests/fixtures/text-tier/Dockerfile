FROM node:20-slim
WORKDIR /srv/app
COPY package.json ./
RUN npm install --omit=dev

COPY dist ./dist
CMD ["node", "dist/index.js"]
