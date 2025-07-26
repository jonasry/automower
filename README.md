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

### Access Token Persistence

After a successful authentication, the script stores the received access token in
`$HOME/.config/autoplanner/access_token.json`. The file includes the token and
its expiration timestamp so that subsequent runs can reuse the token until it
expires. The file is created with owner-only permissions to keep the token
private.
