FROM apify/actor-node:24-slim
COPY --chown=myuser:myuser package*.json ./
RUN npm ci --include=dev --ignore-scripts
COPY --chown=myuser:myuser . ./
RUN npm run build && npm prune --omit=dev --ignore-scripts
CMD ["npm", "start"]
