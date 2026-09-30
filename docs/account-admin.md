# Account administration

Phase 36 adds a protected account dashboard at `/admin.html`. It lists each
username, join date, coin balance, PigeonDex discovery count and current pigeon.
The dashboard deliberately excludes email addresses, Supabase IDs and all
authentication data.

## Setup

1. Apply `migrations/028_account_admin.sql` in the Supabase SQL Editor after
   migration 027.
2. Register the unique username `FredAdmin` through the normal `/sign-up` page.
3. Sign out and sign in with that username. A successful admin login redirects
   to `/admin.html`.

If the account already exists when migration 028 is applied, the migration
promotes it immediately. If it is registered afterward, the server claims the
first administrator role during the verified login. No browser request can
choose an administrator ID or role.

## Coin grants

An administrator can add 1 through 100,000 coins per action. The server resolves
the target by the case-insensitive unique username and updates the balance and
wallet version in one database transaction. It also writes the administrator,
target, amount and timestamp to `game_admin_coin_grants`.

The account tables and RPC functions grant access only to Supabase's
`service_role`. Browser `anon` and `authenticated` roles cannot list accounts,
promote users, read the audit log or grant coins. The HTTP routes independently
verify the current session and administrator membership:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/accounts` | Return the privacy-limited account list |
| `POST` | `/api/admin/coins` | Add coins using `{ username, amount }` |

All admin responses are private and uncached. Coin requests also require the
same application origin and use the existing mutation rate limit.
