FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY agent ./agent
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]

