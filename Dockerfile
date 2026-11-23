FROM apify/actor-node-playwright-chrome:24-1.65.1-slim
COPY package*.json ./
RUN npm ci --include=dev --ignore-scripts
COPY . ./
RUN npm run build && npm prune --omit=dev --ignore-scripts
CMD ["npm", "start"]
