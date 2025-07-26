# Automower API Example

This repository contains a simple Node.js script to fetch your Husqvarna Automower information using the Automower Connect API. The script authenticates using the Authentication API and prints basic mower details.

## Requirements

- Node.js 18+ (uses the built-in `fetch` API).
- Environment variables `HQ_API_KEY` and `HQ_API_SECRET` with your API credentials.

## Usage

Run the script with:

```bash
npm start
```

The script outputs each mower name, model and current activity.
