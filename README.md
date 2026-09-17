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

```bash
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
- `ImageDataUrl`
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
AIRTABLE_SCORES_TABLE=Scores
```

## Test

```bash
npm test
```

## Deploy On Vercel

Import this folder as a Vercel project and set:

```text
ADMIN_TOKEN=your-secret-token
AIRTABLE_API_KEY=your-airtable-token
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_SCORES_TABLE=Scores
```

When `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` are set, leaderboard submissions are saved permanently in the Airtable `Scores` table and aggregated by nickname. Without Airtable configuration, local development continues to use `data/app-db.json`. The Airtable token needs `data.records:read` and `data.records:write` access to the selected base.
