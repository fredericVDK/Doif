# Pigeon Crumbs

A playful pigeon website with a real Node.js backend behind it. Visitors can feed pigeons, submit round scores to a leaderboard, explore PigeonDex breed data, swipe through Pigder, and inspect backend/admin tooling.

Made with Codex.

## Backend Features

- Anonymous session cookie for visitors.
- Persistent JSON storage for local/self-hosted data in `data/app-db.json`.
- Leaderboard API with nickname sanitization and full round-score submission.
- Rate limiting for public API routes.
- Protected admin endpoints using the `x-admin-token` header.
- Server-side Wikimedia/Wikidata cache for PigeonDex breed data.
- Missing breed images are searched through Wikipedia/Commons before falling back to the default image.
- Optional Airtable-backed PigeonDex breed cache.
- Lightweight product event logging for feed milestones and score submissions.
- API docs at `public/api-docs.html` and `/api/docs`.
- Backend tests using Node's built-in test runner.

## Pages

- `public/index.html` - feed pigeons, submit leaderboard scores.
- `public/pigeondex.html` - search, compare, detail pages, daily pigeon, battle arena.
- `public/pigder.html` - swipe through image-backed pigeon breeds.
- `public/admin.html` - protected admin dashboard for moderation and event inspection.
- `public/api-docs.html` - recruiter-friendly API documentation.

## API Overview

- `GET /api/session`
- `GET /api/leaderboard`
- `POST /api/feed`
- `GET /api/breeds`
- `GET /api/breeds/:id`
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

## Optional Airtable Breed Cache

To keep PigeonDex breeds in Airtable, create a base with two tables.

`Breeds` fields:

- `Id`
- `Name`
- `Origin`
- `Size`
- `Flight`
- `Temperament`
- `Fact`
- `History`
- `Image`
- `HasRealImage`
- `ImageSource`
- `SourceUrl`
- `WikidataId`

`Cache` fields:

- `Key`
- `CachedAt`
- `ExpiresAt`
- `Count`

Then set these environment variables:

```text
AIRTABLE_API_KEY=your-airtable-token
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_BREEDS_TABLE=Breeds
AIRTABLE_CACHE_TABLE=Cache
```

When Airtable is configured, the server loads stored pigeon breeds from Airtable first. If the Airtable cache is empty or expired, it refreshes from Wikimedia/Wikidata, searches for missing images through Wikipedia/Commons, and writes the refreshed data back to Airtable.

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
```

The JSON storage works best for local/self-hosted demos. On serverless Vercel, file storage can be temporary between cold starts. For a production-grade leaderboard, the storage layer is ready to be swapped for Vercel KV, Supabase, Neon Postgres, or another managed database.
