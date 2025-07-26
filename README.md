# Automower API Example

This repository contains a simple Node.js script to fetch your Husqvarna Automower information using the Automower Connect API. The script authenticates using the Authentication API and prints basic mower details.

## Requirements

- Node.js 18+ (uses the built-in `fetch` API).
- API credentials either provided via environment variables `HQ_API_KEY` and `HQ_API_SECRET` or stored in `$HOME/.config/autoplanner/credentials.json` with the following structure:

  ```json
  {
    "api-key": "<your api key>",
    "api-secret": "<your api secret>"
  }
  ```

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

The credentials file is likewise updated with the API key and secret that were
used for authentication so that future runs can reuse them without setting
environment variables.
