# Apple Wallet Integration

This backend is prepared for Apple Wallet pass generation.

## Required env vars

APPLE_TEAM_ID
APPLE_PASS_TYPE_ID
APPLE_WALLET_CERT_PASSWORD
APPLE_WALLET_P12_BASE64
APPLE_WWDR_CERT_BASE64

## Certificate handling

The `.p12` and WWDR certificate are stored as encrypted Base64 environment variables in DigitalOcean App Platform.

Claude Code should decode them at runtime using:

Buffer.from(process.env.APPLE_WALLET_P12_BASE64, "base64")
Buffer.from(process.env.APPLE_WWDR_CERT_BASE64, "base64")

Do not commit certificates to GitHub.

## Recommended package

passkit-generator

## Goal

Generate `.pkpass` files from Node.js and return them to the frontend as downloadable Apple Wallet passes.