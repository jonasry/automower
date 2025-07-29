# Use official Node.js 18 image
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Bundle app source
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
