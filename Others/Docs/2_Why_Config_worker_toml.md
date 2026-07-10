# Why vars in config
**You do NOT store secrets in either `wrangler.toml` OR `wrangler.jsonc`.**

Both of those files are committed to git — they're config files, not secret stores. Here's how it actually works:

| What | Where | Why |
|------|-------|-----|
| **Public config** (name, main entry, compatibility flags) | `wrangler.toml` or `wrangler.jsonc` | Safe to commit to git |
| **Non-secret env vars** (e.g., `SUPABASE_URL`) | `wrangler.toml`/`wrangler.jsonc` under `[vars]`/`"vars"` | Safe to commit (just a URL, not a key) |
| **Secrets** (API keys, tokens, passwords) | `wrangler secret put` CLI | Encrypted, never in git, injected at runtime |

So for your project:

**In `wrangler.jsonc` (safe to commit):**
```jsonc
{
  "name": "cognex-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-07-08",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    // Only non-sensitive values here
    "SUPABASE_URL": "https://your-project.supabase.co"
  }
}
```

**Via CLI (encrypted, never in files):**
```bash
npx wrangler secret put SUPABASE_ANON_KEY
# Paste your key when prompted

npx wrangler secret put GROQ_API_KEY
# Paste your key when prompted

npx wrangler secret put GITHUB_TOKEN
# Paste your token when prompted
```

These secrets are stored encrypted in Cloudflare's infrastructure and injected into `env.SUPABASE_ANON_KEY`, `env.GROQ_API_KEY`, etc. at runtime. They never touch your local files or git history.

# If dont want vars
**`wrangler.jsonc` — only public config:**
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cognex-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-07-08",
  "compatibility_flags": ["nodejs_compat"]
}
```

**Then run these commands:**
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEB_SEARCH_API_KEY
```

All five values will be encrypted and injected into `env` at runtime. Your code accesses them the same way:

```javascript
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
```