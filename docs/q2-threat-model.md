# Q2(d): Threat agents, controls and GDPR

**Why GDPR (not HIPAA):** Cognex stores personal data about identifiable people (user e-mails, GitHub contributor usernames and avatar URLs) but no health data, so GDPR is the applicable regulation, HIPAA is not.

**Most sensitive data (Q2a):** user e-mails + password hashes + TOTP secrets in `users`; GitHub contributor identities/avatars in `graph_nodes`.

| Threat agent | What they want | Control implemented | GDPR requirement | Why it matches |
|---|---|---|---|---|
| **Brute-force attacker** (external) | Guess a password, take over an account | bcrypt (cost 10, salted); mandatory TOTP MFA (no access token without a valid code); login lockout after 5 failures per e-mail/IP (HTTP 429, counted in the shared `audit_log`, so it holds across all 3 instances); security-monitor agent flags failure bursts | **Art. 32(1)**: security of processing, "appropriate technical and organisational measures" incl. ensuring ongoing confidentiality of processing systems | Hashing, MFA and lockout are technical measures protecting confidentiality of the accounts and the data behind them |
| **Malicious insider** (authenticated user abusing access) | Delete or alter data they should not touch | Role-based access: `viewer` read-only, `editor` update, `admin` delete; every PUT/DELETE needs a valid access JWT and role (401/403 otherwise); append-only `audit_log` (DB trigger blocks UPDATE/DELETE); agent flags mass deletes by one account | **Art. 32(4)**: anyone acting under the controller's authority with access to personal data must process it only on instructions (also supports Art. 5(1)(f) integrity and confidentiality) | Least-privilege roles plus an immutable trail enforce "only as authorised" and make misuse detectable |

## Data minimisation in the agents
The security-monitor agents are read-only, never block users or delete anything, and receive only a pseudonymised per-actor table: e-mails and IPs are replaced by salted-hash tokens (`user_3fa9c1`, `ip_77b0de`) before any prompt is sent to Groq (tested in `test/node/agents.test.js`).

## Known limits (state these in the report)
- The Cloudflare Worker deployment (`src/index.js`) is unchanged and has no auth; the secured deployment is the Node/Docker stack.
- Reads (`GET`) and `POST` create endpoints are public by design in this assignment; only Update and Delete are role-restricted, as the question asks.
- TOTP codes are not tracked against replay within their validity window.
- Not legal advice: this maps controls to articles for the assignment.
