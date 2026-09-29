# Accounts — phase 2

Registration, email confirmation, sign-in, sign-out, profile creation and protected
routes are implemented. The local project has since been configured and the user
confirmed registration works. For a fresh installation, until setup is complete,
account forms are disabled and protected account pages return 503.
All existing public pages and APIs remain available.

Phase 3 adds adoption; see [the adoption upgrade instructions](adoption-setup.md).

## Create and connect the Supabase project

1. Create a Supabase project in your own account at https://supabase.com/dashboard.
   Keep the project's database password private; the app uses the API keys below.
2. In its SQL editor, apply `migrations/001_tamagotchi.sql` once, then
   `seeds/tamagotchi-starters.sql`. No second database migration is needed for phase 2.
3. Copy the project URL, a publishable key (or legacy anon key), and a server secret
   key (or legacy service_role key) from the project's API key settings.
4. Add the following variables to the existing local `.env`, preserving Airtable
   variables. Use real keys only in `.env` or deployment secrets, never in Git or chat:

   ```dotenv
   APP_ORIGIN=http://localhost:3000
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   SUPABASE_SECRET_KEY=YOUR_SECRET_OR_SERVICE_ROLE_KEY
   ```

   `APP_ORIGIN` must be the exact origin you open in the browser, including port.
   On Vercel it may be omitted: the server then uses Vercel's trusted
   `VERCEL_PROJECT_PRODUCTION_URL` automatically.
   `localhost` and `127.0.0.1` are different origins. If `PORT` is set, use that port.
   Production origins must use HTTPS; URLs with credentials, paths, queries or
   fragments are rejected. No keys are embedded in browser JavaScript or HTML.
5. In Supabase Auth, enable email/password sign-in and keep email confirmation on.
   Set Site URL to your application origin. Add the exact callback URL
   `http://localhost:3000/auth/callback` to the allowed redirect URLs for development.
   For deployment, add `https://YOUR_SITE/auth/callback` and set Site URL to the
   production origin. Keep the standard signup email confirmation link using
   `{{ .ConfirmationURL }}`; the SDK handles PKCE.
6. Configure SMTP for real users. Supabase's default mail service is limited and
   is not a general production email delivery service. Configure a minimum password
   length of 12 in Auth settings to match the app's registration form.
7. Use Node.js 22 or newer, run `npm ci`, then restart `npm start`. Copy the four
   variables into the deployment environment too before deploying account support.

The server never creates a Supabase project automatically and never falls back to
storing passwords or game profiles in the legacy JSON file.

Official references: [password authentication](https://supabase.com/docs/guides/auth/passwords),
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[API keys](https://supabase.com/docs/guides/api/api-keys).

## User flow and phase boundaries

- `/sign-up`: username, email and password. With confirmation enabled, display a
  check-your-email message. Confirm the link in the **same browser** used to register;
  the PKCE verifier lives in an HttpOnly cookie there. No game profile is created
  before an authenticated, email-confirmed identity is returned by Supabase.
- `/auth/callback`: exchange the single-use code with its verifier and redirect to
  `/adopt`. An expired/missing code or a different browser redirects to sign-in
  with a useful message. If email confirmation already succeeded, signing in with
  the password can finish profile creation even when the callback could not.
- `/sign-in`: successful existing login redirects to `/my-pigeon`.
- `/complete-profile`: if a username was taken before confirmation, or a profile
  is missing, choose an available username. Repeated requests return the existing
  profile instead of overwriting its name, identity or balance.
- `/logout`: a confirmation page with an explicit button. Only the POST action
  signs out. It revokes the current refresh session and clears account cookies.
- `/adopt` and `/my-pigeon`: protected account welcome pages for now. These are
  deliberately not an adoption form or game dashboard; those belong to phases 3/4.

The homepage links to My Pigeon. Visitors without an account can keep using Home,
PigeonDex, Pigder, Drawings and all existing public endpoints.

## HTTP contract

Account responses are `private, no-store`, including HTML, redirects and errors.
Every POST requires JSON and an `Origin` header matching the configured
`APP_ORIGIN`; cross-site submissions are rejected. There is no wildcard CORS.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/auth/session` | `{ configured, user, needsProfile? }`; `user` is null when signed out |
| POST | `/api/auth/sign-up` | `{ username, email, password }` → 202 confirmation notice, or signed-in result |
| POST | `/api/auth/sign-in` | `{ email, password }` → `{ user, redirect }` |
| POST | `/api/auth/profile` | `{ username }` → authenticated profile completion |
| POST | `/api/auth/sign-out` | `{}` → sign-in redirect destination |

Errors use `{ error, code }`. Validation returns 400; authentication 401; origin
violations 403; username conflicts 409; large bodies 413; wrong content type 415;
rate limits 429; missing configuration/provider/storage failures 503. Responses
never contain access tokens, refresh tokens, keys or passwords.

## Session and authorization implementation

`lib/auth/supabase.js` creates a new official `@supabase/ssr` client for each
request. The SDK implements cookie chunking, refresh rotation and PKCE. The app
stores only tokens in HttpOnly, SameSite=Lax, host-only cookies; HTTPS cookies use
the `__Host-` prefix and Secure. Cookie lifetime is 30 days, while actual session
validity and expiry remain under Supabase Auth control. Tokens are never put in
localStorage or made available to the browser script.

Every protected request calls `auth.getUser()` to verify identity with Supabase.
The server does not authorize from unsigned cookie user data, `getSession()`,
anonymous feeding cookies, submitted user IDs or metadata. It also rejects
anonymous Auth identities and unconfirmed emails.

The separate server-key client reads or creates `game_users`, always filtered by
the verified identity. Initial creation sends only `id` and validated `username`;
SQL supplies the zero coin balance. Username metadata supplies a proposed display
name only. Email comes from the verified Auth user and is not duplicated locally.

The app checks the exact request Origin to protect cookie-authenticated POSTs,
including login and logout. Confirmation callbacks are bound to the PKCE verifier;
all application redirects are fixed local paths, not a caller-provided `next` URL.
Account pages use a restrictive CSP, no third-party scripts and no-referrer.
Errors logged by the account handler contain only an error code/provider code.

The in-process limiter uses the socket address, not untrusted forwarded headers or
visitor cookies: 20 attempts per write route per 10 minutes, 180 reads per minute.
It resets on restart and is not a distributed limiter. Behind a proxy, clients may
share a socket address; production should apply suitable edge limits. Supabase
also enforces its own configured auth limits. This phase does not provision that
infrastructure.

Sign-out uses Supabase's `local` scope. As with Supabase generally, already-issued
access tokens can remain valid until expiry; refresh tokens are revoked. A provider
outage is surfaced instead of falsely reporting successful revocation.

## Verification and remaining setup

```bash
npm test
npm run test:auth
```

Tests exercise the actual SDK and server routes against a simulated Auth and
PostgREST service. They cover registration, confirmation/PKCE, profile conflicts,
login/logout, refresh, forged sessions, ownership, cookie flags, input validation,
CSRF/origin checks, unavailable storage and rate limiting. The phase 1 tests execute
the actual SQL schema and access policies in PGlite.

After creating the real project, verify separately:

1. Register a test account and receive/confirm its real email in the same browser.
2. Check the Auth user and corresponding `game_users` row; initial coins must be 0.
3. Reload a protected page, close/reopen the browser and verify the session persists.
4. Sign out, verify protected pages redirect to sign-in, then sign in again.
5. Try another account to confirm profile isolation against the hosted database.

The user has confirmed hosted registration works. Automated tests still use
simulated Auth, and do not create hosted accounts or send emails. Phase 3 adoption
has separate SQL and browser checks; its hosted migration must be applied before
the real adoption flow can be checked.

## Files changed in phase 2

Added: `lib/auth/supabase.js`, `lib/auth/routes.js`, `lib/auth/pages.js`,
`public/auth.css`, `public/auth.js`, `test/auth.test.js`, and this setup guide.

Updated: `server.js` (route dispatch, assets and API documentation),
`public/index.html` (account link), `.env.example` (configuration),
`package.json` and `package-lock.json` (official SDKs, Node requirement and test script),
`README.md` and `docs/tamagotchi-model.md` (current status and setup links).

The existing local `.env`, `data/app-db.json` and user-provided image were not edited.
