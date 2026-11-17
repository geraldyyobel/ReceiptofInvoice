FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DATABASE_PROVIDER=sqlite DATABASE_URL=file:../../data/roi.db
COPY package*.json ./
RUN npm ci --no-audit --no-fund
RUN mkdir -p /etc/ssl/certs && node -e "require('fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('tls').rootCertificates.join('\n'))" \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && npx playwright install --with-deps chromium \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run db:prepare && npm run build && mkdir -p /app/data && chown -R node:node /app/data /app/prisma/generated /app/node_modules/.prisma
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/container-start.js"]
