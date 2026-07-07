## 📘 TOML (Tom’s Obvious Minimal Language)

### 🔑 Syntax Basics
- **Key = Value pairs** (no braces, no commas).
- Strings are wrapped in quotes (`" "`).
- Numbers, booleans, and dates are written directly.
- Sections are defined with `[section]`.

**Example:**
```toml
name = "cognex-worker"
main = "src/index.js"
compatibility_date = "2026-07-08"

[vars]
SUPABASE_URL = "https://xyz.supabase.co"
DEBUG = true
PORT = 8080
```

### ✅ Use Cases
- Configuration files for apps (Wrangler, Cargo for Rust, etc.).
- Human-friendly: easy to read and edit manually.
- Great for environment variables and structured config.

---

## 📗 JSONC (JSON with Comments)

### 🔑 Syntax Basics
- Strict **JSON structure**: `{ }` for objects, `[` ]` for arrays.
- Keys must be quoted (`"key": "value"`).
- Commas separate entries.
- **Comments allowed** (`//` or `/* ... */`), unlike plain JSON.

**Example:**
```jsonc
{
  "name": "cognex-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-07-08",
  "vars": {
    "SUPABASE_URL": "https://xyz.supabase.co",
    "DEBUG": true,
    "PORT": 8080
  }
  // This is a comment
}
```

### ✅ Use Cases
- When you want JSON tooling (linting, schema validation).
- Easier integration with systems that already use JSON.
- Comments help document config inline.

---

## ⚖️ Comparison

| Feature | TOML | JSONC |
|---------|------|-------|
| **Readability** | Very human-friendly | More verbose, but familiar |
| **Structure** | Minimal, section-based | Strict JSON objects/arrays |
| **Comments** | Supported via `#` | Supported via `//` or `/* */` |
| **Wrangler Default** | Yes (Cloudflare docs use TOML) | Supported, but secondary |
| **Best For** | Quick manual edits, env vars | JSON-based workflows, tooling |

---

## 🌐 Why Cloudflare Wrangler Uses TOML
- **Simplicity**: Easier for developers to hand-edit.
- **Convention**: TOML is widely used in config files (Rust, Python tools).
- **Clarity**: No need for braces/commas → fewer syntax errors.
- **Default**: Wrangler CLI expects `wrangler.toml` first.

---

## 🛠️ How to Create and Write Without Internet
You don’t need docs or AI — just remember:
- **TOML** → `key = "value"`, group with `[section]`.
- **JSONC** → `{ "key": "value" }`, commas between entries, comments allowed.
- Save the file as plain text (`wrangler.toml` or `wrangler.jsonc`) in your project root.
- Wrangler will automatically pick it up when you run commands.

---

👉 In short: **TOML is the default and simplest choice** for Cloudflare Workers. Use JSONC only if you’re already in a JSON-heavy workflow or want schema validation.
