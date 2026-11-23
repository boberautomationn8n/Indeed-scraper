FROM apify/actor-node-playwright-chrome:24-1.65.1-slim
COPY --chown=myuser:myuser package*.json ./
RUN npm ci --include=dev --ignore-scripts
COPY --chown=myuser:myuser . ./
RUN npm run build && npm prune --omit=dev --ignore-scripts
CMD ["npm", "start"]
