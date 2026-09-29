# Pigeon Crumbs (https://doif-eta.vercel.app/)

A playful pigeon website with a real Node.js backend behind it. Visitors can feed pigeons, submit round scores to a leaderboard, explore PigeonDex breed data, swipe through Pigder, and inspect backend/admin tooling.

Made with Codex.

## Backend Features

- Anonymous session cookie for visitors.
- Persistent JSON storage for local/self-hosted data in `data/app-db.json`.
- Leaderboard API with nickname sanitization and full round-score submission.
- Rate limiting for public API routes.
- Protected admin endpoints using the `x-admin-token` header.
- Community drawing submissions stored locally and optionally mirrored to Airtable.
- BirdNET as the primary species API, supplemented by Wikipedia/Wikidata for domestic breeds.
- PigeonDex shows only entries with their own photo; the API retains the complete catalogue for future enrichment. Records distinguish species from domestic breeds.
- Bundled catalogues and independent source caches keep the PigeonDex available during upstream outages.
- Optional Airtable storage for drawings and permanent leaderboard scores.
- Lightweight product event logging for feed milestones and score submissions.
- API docs at `public/api-docs.html` and `/api/docs`.
- Backend tests using Node's built-in test runner.

## Pages

- `public/index.html` - feed pigeons, submit leaderboard scores.
- `public/pigeondex.html` - search, compare, detail pages, daily pigeon, battle arena.
- `public/pigder.html` - swipe through image-backed pigeon breeds.
- `public/drawings.html` - submit and browse AI-checked pigeon drawings.
- `public/admin.html` - protected admin dashboard for moderation and event inspection.
- `public/api-docs.html` - recruiter-friendly API documentation.

## API Overview

- `GET /api/session`
- `GET /api/leaderboard`
- `POST /api/feed`
- `GET /api/breeds`
- `GET /api/breeds/:id`
- `GET /api/drawings`
- `POST /api/drawings`
- `POST /api/events`
- `GET /api/admin/leaderboard`
- `DELETE /api/admin/leaderboard/:nickname`
- `POST /api/admin/reset-leaderboard`
- `GET /api/admin/events`

## Run Locally

Use Node.js 22 or newer (required by the account SDK).

```bash
npm ci
npm start
```

Then open `http://localhost:3000`.

For the admin dashboard, the local default token is:

```text
dev-admin
```

Set a real token for production:

```bash
ADMIN_TOKEN=your-secret-token npm start
```

## PigeonDex catalogue

BirdNET is the primary source for wild species: [API documentation](https://birdnet.cornell.edu/taxonomy/docs). No BirdNET API key is required. Domestic breeds come from the [Wikipedia breed list](https://en.wikipedia.org/wiki/List_of_pigeon_breeds), with article summaries, article images and Wikidata origins where available.

The included import contains **350 species and 701 domestic breed entries**. This is coverage of these sources, not a guarantee that every recognised breed worldwide is listed. The Wikipedia list can contain synonyms or regional variants and needs editorial review. Missing traits remain unknown rather than being inferred from names. BirdNET currently has no family filter: the importer reads every bird page and selects reviewed Columbidae genera in `lib/birdnet.js`. Review that allowlist when the taxonomy version changes.

`GET /api/breeds` returns `breeds`, `count`, `counts`, `primarySource`, `sources`, `cachedAt` and `expiresAt`. The legacy route name stays compatible with existing pages. Each entry has `kind: "species"` or `kind: "breed"`. Species use stable `birdnet:BN...` IDs; domestic entries keep their Wikipedia title IDs. `GET /api/breeds/:id` accepts a URL-encoded ID. Localised names, scientific names, aliases, external IDs and field provenance are available for future enrichment. Favourites and links to retained domestic IDs keep working.

The server serves bundled snapshots immediately on a cold start, with their actual import timestamp. Each source is cached independently for six hours; long-running servers refresh expired sources and retry failures after five minutes while retaining saved records. Serverless instances may restart before an automatic refresh, so update the bundled snapshots before deployment or when you want new source data:

```bash
npm run refresh:catalog
# Only refresh wild species:
npm run refresh:catalog -- --species-only
```

This writes `data/birdnet-pigeons.json` and `data/domestic-pigeons.json`, without changing the application database. Restart the server after refreshing; an existing fresh runtime cache can remain active for up to six hours. Commit/deploy the snapshot files with the code. Source status and counts are exposed through the API, and the page reports when a refresh failed.

BirdNET image attribution and license metadata are retained and displayed with original links. Photos without an explicit Creative Commons/public-domain license use a placeholder. License conditions such as noncommercial use still apply; images and descriptions do not inherit a blanket license from the API. Wikipedia descriptions link back to their source. Pigder uses the same catalogue but selects entries with photos for the swipe game.

## Optional Airtable Storage

Optional `Drawings` table fields:

- `Id`
- `Artist`
- `Title`
- `Image` (attachment)
- `Status`
- `IsDrawing`
- `IsPigeon`
- `Confidence`
- `AiFeedback`
- `CreatedAt`

For a permanent leaderboard, add a `Scores` table. Each completed game is stored as one row so submissions from different devices cannot overwrite each other. Use these fields:

- `SubmissionId` (single line text, primary field)
- `Nickname` (single line text)
- `Amount` (number)
- `SessionId` (single line text)
- `CreatedAt` (date with time)

Then set these environment variables:

```text
AIRTABLE_API_KEY=your-airtable-token
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_DRAWINGS_TABLE=Drawings
AIRTABLE_DRAWINGS_IMAGE_FIELD=Image
AIRTABLE_SCORES_TABLE=Scores
```

When Airtable is configured, drawing metadata is stored in `Drawings` and the uploaded image is saved in its `Image` attachment field. The gallery reads those Airtable records directly, so drawings remain available across devices and deployments. Without Airtable configuration, local development uses `data/app-db.json`.

## Test

```bash
npm ci
npm test
```

## Tamagotchi development

Phase 1 adds the game schema and starter species. Phase 2 adds account routes,
registration, sign-in/sign-out and server-verified sessions.
Accounts require a configured Supabase project; without one the public website
still works and the account forms clearly show they are unavailable. Existing
JSON/Airtable storage remains unchanged. Phase 3 adds adoption: choose a Jacobin
pigeon, Indian Fantail or Australian Saddleback Tumbler, name it, and save it to
your account. One pigeon per account is enforced in the database.

Start with [the Supabase account setup guide](docs/auth-setup.md), then visit
`/sign-up` or `/sign-in`. Apply the additional migration described in
[the adoption setup guide](docs/adoption-setup.md) before using `/adopt`.
`/my-pigeon` now shows the phase 4 dashboard: the saved pigeon, level, XP, coins
and five accessible stat bars. See [the dashboard guide](docs/dashboard.md).
Phase 5 adds time-based stat decay when opening or refreshing the pigeon. Apply
`migrations/003_time_engine.sql` once before running this version; see
[the time-engine guide](docs/time-engine.md). No background scheduler is required.
Phase 6 enables Feed with free Crumbs: up to +15 Hunger, +2 Happiness and +5 XP,
saved atomically after time decay. Apply `migrations/004_feed.sql` once after 003;
see [the feeding guide](docs/feed.md). Phase 7 enables Play: -10 Energy, up to
+15 Happiness and +10 XP, with a server-enforced energy check and cooldown.
Apply `migrations/005_play.sql` once after 004; see [the Play guide](docs/play.md).
Phase 8 enables Clean: up to +30 Cleanliness, +5 Happiness and +5 XP, with a
server-enforced cooldown and safe retries. Apply `migrations/006_clean.sql` once
after 005; see [the Clean guide](docs/clean.md). Phase 9 enables Sleep: immediate
recovery of up to +30 Energy and +5 Happiness, without XP or coins. Apply
`migrations/007_sleep.sql` once after 006; see [the Sleep guide](docs/sleep.md).
Phase 10 adds central XP rewards and automatic levels, with carry-over XP and a
progress bar. Apply `migrations/008_xp_levels.sql` once after 007; it converts
existing earned XP into levels. See [the XP guide](docs/xp-levels.md).
Phase 11 adds automatic growth stages: Hatchling at level 1, Juvenile at level 5,
Adult at level 10 and Best Friend at level 25. Apply `migrations/009_growth_stages.sql`
once after 008; see [the growth guide](docs/growth-stages.md).
Phase 12 adds coin rewards: Feed +2, Play +5 and Clean +2. Apply
`migrations/010_coins.sql` once after 009, before starting this version; see
[the coin guide](docs/coins.md). Balances update immediately and retries cannot
award coins twice. Phase 13 links the existing PigeonDex to each account: adoption
and the daily pigeon unlock entries, undiscovered cards hide their details and a
new-discovery dialog links to the full catalogue entry. Apply
`migrations/011_discoveries.sql` once after 010; see
[the discovery guide](docs/pigeondex-discoveries.md). Phase 14 grants a daily
login reward on the first dashboard visit after 00:00 UTC: +50 Pigeon Coins and
+20 XP. Apply `migrations/012_daily_reward.sql` once after 011; see
[the daily reward guide](docs/daily-reward.md). The database enforces one atomic
reward per account and UTC calendar day. Phase 15 adds a protected inventory with
Crumbs, Corn, Peas and Sunflower Seeds. Apply `migrations/013_inventory.sql` once
after 012; see [the inventory guide](docs/inventory.md). Phase 16 adds the
server-authoritative [Shop](docs/shop.md): apply `migrations/014_shop.sql` after
013. Purchases atomically spend coins and add inventory with idempotent retries.
Existing free Crumbs remain available alongside owned food.
Phase 17 gives every public and account page the same responsive navigation for
Home, My Pigeon, PigeonDex, Shop, Inventory, Pigder, Drawings and API. It needs no
database migration; see [the navigation guide](docs/navigation.md).
Phase 18 adds four [daily quests](docs/daily-quests.md) with visible progress,
one-time coin and XP rewards, and a reset at 00:00 UTC. Apply
`migrations/015_daily_quests.sql` once after 014.
Phase 19 adds five permanent [achievements](docs/achievements.md) based on saved
care, level, discovery, growth and inventory progress. Apply
`migrations/016_achievements.sql` once after 015; each reward can be claimed once.
Phase 20 adds the responsive [Catch the Crumbs](docs/catch-the-crumbs.md)
minigame. The database owns each 30-second schedule, validates catch timing and
movement, and calculates the XP and coin reward. Apply
`migrations/017_catch_the_crumbs.sql` once after 016.
Phase 21 refines the [Tamagotchi UI and feedback](docs/ui-ux.md): the pigeon now
sits in a central stateful roost scene, care actions have restrained animations,
and Inventory and Shop are available as responsive dashboard cards. It needs no
database migration and respects the reduced-motion preference.
Phase 22 formalizes the [game architecture](docs/game-architecture.md) around one
composed service, shared validation/error helpers and one response-presentation
adapter. Existing endpoints and database-authoritative rules remain unchanged;
this phase needs no migration.
Phase 23 registers every authenticated [game API and backend action](docs/game-api.md)
in one method/handler/documentation contract. `/api/docs` now includes the game
surface, and `GET /api/game/pigeondex` exposes the existing discovery progress
under a clear name while retaining the compatibility path. No migration is needed.
Phase 24 centralizes [error handling](docs/error-handling.md). Safe API responses
now include a stable code, retry guidance and an opaque request reference, while
technical failures are logged separately without credentials or request bodies.
Repeated daily reward claims remain successful and never award twice. No migration
is needed.
Phase 25 completes the [security audit](docs/security.md): verified account identity,
server-only game mutations, read-only client RLS, strict API validation, hardened
browser headers, secure random session IDs and fail-closed admin access. No database
migration is needed because the existing migrations already enforce the required
RLS policies and function privileges.
Phase 26 adds the complete [testing matrix](docs/testing.md), including an
end-to-end MVP test that returns after 48 hours, performs every care action,
levels up, changes growth stage, claims a daily reward, purchases an item and
verifies inventory and account isolation. It needs no migration.
The inventory-feeding update connects owned Corn, Peas and Sunflower Seeds to the Feed menu. Each
meal uses the effects stored in the item catalogue and atomically removes one
item; safe retries never consume a second item. Apply
`migrations/018_inventory_feeding.sql` once after 017. Free Crumbs remain
available and do not consume inventory. See the [feeding guide](docs/feed.md).
Phase 27 provides the requested starter and item seed data; the main catalogue
supplies additional real pigeon species. Phase 28 is covered by the end-to-end
MVP and regression suite. New phase 29 adds server-authoritative
[Pigeon Battles](docs/pigeon-battles.md) directly on My Pigeon: an opponent is
selected automatically, difficulty rises with level, losses award no XP and a
win awards `15 + (level × 3)` XP. Apply `migrations/019_pigeon_battles.sql` after 018.
Losing removes `4 + level` Health (capped at 20), without allowing a negative stat.
Projects that already ran the first opponent-selection version of migration 019
must run `migrations/020_automatic_battles.sql` instead of rerunning 019.
Apply `migrations/021_battle_health.sql` afterward to enable the loss penalty, then
`migrations/022_level_scaled_battle_damage.sql` to scale damage with level.

Pigeon Packs add a 300-coin daily Normal Pack with two random photo-verified
pigeons and a 900-coin weekly Big Pack with five, both presented in the Shop. A previously discovered pigeon
returns 50 coins. Purchases, UTC limits, random catalogue selection, discovery
writes and refunds are server-owned and idempotent. Apply
`migrations/023_pigeon_packs.sql` once after migration 022; see
[the Pigeon Packs guide](docs/pigeon-packs.md).
Phase 31 adds the [Pigeon Clinic](docs/pigeon-clinic.md) to My Pigeon. A
server-authoritative visit costs 100 coins and restores the pigeon to 100 Health;
full Health is never charged and retries count once. Apply
`migrations/024_pigeon_clinic.sql` once after migration 023.
Phase 32 expands progression with seven daily quests and ten permanent
achievements. Sleep, Battle and Catch the Crumbs now have daily goals; long-term
goals cover battles, packs, clinic visits, minigame rounds and 100 discoveries.
Apply `migrations/025_more_quests_achievements.sql` once after migration 024.
Phase 33 adds a full-screen Pigeon Pack opening sequence: a Jacobin wrapper tears
open and deals the real two or five reward cards before offering PigeonDex and
close actions.
Phase 34 frames Catch the Crumbs on the dashboard and game page, and expands the
permanent progression track to 20 achievements. Apply
`migrations/026_more_permanent_achievements.sql` once after migration 025.
Phase 35 removes email from the player account flow. Registration and login use
only a unique username and password while Supabase Auth remains server-verified.
Apply `migrations/027_username_password_accounts.sql` once after migration 026.
The player-facing catalogue is photo-only: 269 wild species and 137 domestic
breeds currently qualify. Records that would use the generic replacement image
are excluded from PigeonDex, daily discovery and catalogue API results.

See [the model, migration instructions and phase boundaries](docs/tamagotchi-model.md).
Run `npm run test:game` to execute the schema tests locally with PGlite; no hosted
database or credentials are needed. PGlite is used only for development tests.
`npm run test:auth` tests the actual Supabase SDK and HTTP flow against a simulated
upstream service; it does not create hosted accounts or send emails.

Regenerate the original phase 1 species seed from the bundled BirdNET catalogue:

```bash
npm run seed:game -- --output seeds/tamagotchi-starters.sql
```

This produces SQL only; it does not apply it to any database.

The current three starter breeds are included in `migrations/002_adoption.sql`.
`npm run seed:adoption` refreshes its generated breed section from the domestic
catalogue and reviewed photo credits. Apply migrations in order: 001, the original
species seed, then 002 through 019 in order. Do not rerun migrations after they have succeeded.
`npm run test:adoption` covers the actual SQL adoption function through HTTP tests
with simulated Supabase Auth and a local PGlite database.

## Deploy On Vercel

Import this folder as a Vercel project and set:

```text
ADMIN_TOKEN=your-secret-token
AIRTABLE_API_KEY=your-airtable-token
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_SCORES_TABLE=Scores
```

When `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` are set, leaderboard submissions are saved permanently in the Airtable `Scores` table and aggregated by nickname. Without Airtable configuration, local development continues to use `data/app-db.json`. The Airtable token needs `data.records:read` and `data.records:write` access to the selected base.
