// Handy for demos/screenshots without a phone: prints the current 6-digit code for a base32 secret.
// Usage: node scripts/mfa-cli.mjs <BASE32_SECRET>
import { generateSync } from 'otplib';
console.log(generateSync({ secret: process.argv[2] }));
