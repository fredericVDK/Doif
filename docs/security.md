# Security

Pigeon Crumbs treats the browser as untrusted. Account identity comes from Supabase `auth.getUser()` on every protected request. Client cookies, request bodies and query parameters never select the user whose game state is changed.

## Game boundary

- The browser sends intent and idempotency IDs only. Coins, XP, stats, prices, rewards, dates and cooldowns are calculated by PostgreSQL functions.
- The Supabase secret or service-role key is used only by the Node server and is absent from public assets.
- Game tables have RLS enabled. Authenticated clients receive own-record read policies and no write policies.
- Every game mutation function revokes execution from `PUBLIC`, `anon` and `authenticated`, then grants it only to `service_role`.
- Shop purchases, rewards and care actions lock the relevant rows and save receipts so retries and concurrent requests cannot duplicate value.

## HTTP boundary

- Protected mutations require a verified user, a matching application origin, JSON content, validated fields and the registered HTTP method.
- Public pages use a Content Security Policy without inline script or eval permissions, plus clickjacking, MIME sniffing, referrer and browser-feature restrictions.
- Anonymous session identifiers use cryptographically secure UUIDs. Their cookies are HttpOnly and SameSite Strict, with Secure enabled on HTTPS.
- Proxy IP headers are ignored unless `TRUST_PROXY=1` is explicitly configured. Invalid forwarded addresses are rejected.
- Production admin endpoints fail closed when `ADMIN_TOKEN` is absent, and token comparison is constant-time for equal-length values.
- Provider and database error messages are logged as restricted metadata and are not returned to browsers.

## Deployment

Use an HTTPS `APP_ORIGIN`, keep `SUPABASE_SECRET_KEY` and `ADMIN_TOKEN` in server-side environment settings, and never expose them with a public build prefix. Set `TRUST_PROXY=1` only when the hosting proxy overwrites or sanitizes `X-Forwarded-For`.
