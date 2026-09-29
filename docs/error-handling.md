# Error handling

Pigeon Crumbs keeps player-facing errors separate from technical diagnostics.

## API contract

Failed game and account requests return JSON with a safe `error` message, a stable `code`, a `requestId`, and a `retryable` flag. Cooldowns also return `retryAfter` and the matching HTTP `Retry-After` header. Errors that contain an authoritative refreshed pigeon may include that pigeon and its rendered presentation so the browser can show the latest saved state.

Expected player conditions use specific messages, including no adopted pigeon, insufficient coins, unavailable items, insufficient energy, invalid starter choices, active cooldowns, and expired sessions. A repeated daily reward claim is an idempotent success: it awards nothing twice and explains when the next reward becomes available.

Unexpected and database failures return a generic temporary-unavailability message. Provider messages, credentials, tokens, request bodies and email links are never sent to the browser.

## Technical diagnostics

Every owned account or game request receives an `x-request-id`. Server logs for failures contain that ID, method, route, status, stable application code, and a short provider code when one is safe. They do not contain the player-facing request body or the provider's raw error message.

Optional dashboard panels log a warning if they cannot load while the main pigeon page remains usable.
