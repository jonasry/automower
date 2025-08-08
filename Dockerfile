# Use official Node.js 18 slim image
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

# Bundle app source
COPY src/ ./src/
COPY public/ ./public/
COPY messages.txt ./

# Directory for the database file
RUN mkdir ./db

EXPOSE 3000
CMD ["npm", "start"]
