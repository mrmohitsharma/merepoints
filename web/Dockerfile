# Static build served by nginx (for local docker-compose; on AWS the same files go to S3 + CloudFront).
FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:3000/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx next build

FROM nginx:1.27-alpine
COPY --from=build /app/out /usr/share/nginx/html
RUN printf 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/index.html $uri.html =404; } }\n' > /etc/nginx/conf.d/default.conf
