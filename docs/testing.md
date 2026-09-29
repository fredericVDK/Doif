# Testing

Phase 26 combines focused rule tests with one complete MVP flow.

The focused suites cover stat decay and 0–100 bounds, Feed, Play and energy checks, Clean, Sleep, XP carry-over, levels, growth stages, daily rewards, shop pricing, inventory quantities, authentication, authorization, RLS, concurrent actions, idempotent retries and storage rollback.

`test/mvp-flow.test.js` exercises the boundaries together through the real HTTP handler and all PostgreSQL migrations in PGlite. It advances one pigeon by 48 hours without background work, refreshes the saved state, performs every care action, crosses a level and growth threshold, claims and repeats the daily reward, buys a database-priced item, verifies inventory and confirms that a second account cannot target the first account with a forged user ID.

Run the complete verification with:

```bash
npm test
```

Run only the integrated MVP scenario with:

```bash
npm run test:mvp
```

The tests use simulated Supabase Auth and an in-memory PGlite database. They do not create hosted users, alter the hosted database or require credentials.
