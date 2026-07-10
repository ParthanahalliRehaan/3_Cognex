## Why Web Search?

Our app answers questions about **GitHub repositories**. But sometimes the repo itself doesn't have the answer. Examples:

| User Question | Repo Has Answer? | Web Search Needed? |
|-------------|----------------|-------------------|
| "What does this function do?" | ✅ Yes — in the code | ❌ No |
| "Who wrote the auth feature?" | ✅ Yes — in commits | ❌ No |
| "What is the latest version of React?" | ❌ No — repo is static | ✅ Yes |
| "How does this compare to Vue.js?" | ❌ No — not in repo | ✅ Yes |
| "Is this library still maintained?" | ⚠️ Maybe — check recent commits | ✅ Yes — verify with web |

**Web search is a "fallback"** — when the knowledge graph + embeddings don't have enough context, the agent searches the web for fresh, external information.

---

## Get Your Serper API Key

**Go to [serper.dev](https://serper.dev)**

1. Sign up (free tier: 2,500 queries)
2. Go to **Dashboard → API Key**
3. Copy your key

**Add it to your `.env`:**

```env
WEB_SEARCH_API_KEY=your-serper-api-key
```

---

## Or Use Brave Search (Alternative)

**Go to [api.search.brave.com](https://api.search.brave.com)**

1. Sign up (free tier: 2,000 queries/month)
2. Get your API key

---

## Quick Question

Do you want to:
- **A)** Get Serper key now and add it
- **B)** Skip web search for now, build the core app, add search later

**Either is fine.** The core app works without it — web search is just a bonus feature.