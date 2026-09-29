# Tamagotchi — data model

Status: phase 1 schema, starter import and database tests implemented on `tamagotchi`.
Phase 2 adds account integration; see [account setup](auth-setup.md). Phase 3 adds
domestic starter breeds and atomic adoption; see [the upgrade guide](adoption-setup.md).
The user has configured Supabase and confirmed registration and adoption work.
Phase 4 displays the saved state in [the pigeon dashboard](dashboard.md), with no
additional database migration. Existing public features still use their original storage.
Phase 5 adds [time-based decay](time-engine.md) with migration 003, including
12-decimal precision for the four declining stats and server-only atomic refresh.

## Storage and authentication decision

Keep plain HTML/CSS/JavaScript and the existing Node HTTP server. Add Supabase
Postgres for personal game data and Supabase Auth for identity. JSON/Airtable
continue to serve the existing leaderboard, drawings and catalogue cache.

The JSON writer cannot provide transactional updates or uniqueness guarantees
across server instances. Game progress must have those guarantees. No game state
should fall back to the JSON file, temporary storage or browser localStorage when
Postgres is unavailable: later endpoints should return a retryable error instead.

Supabase owns passwords, identity verification and session credentials. The
application does not add password columns or promote anonymous `pigeon_session`
cookies or leaderboard nicknames into authenticated identities.

References: [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data),
[row security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Model and naming

SQL uses snake_case; future Node responses should expose the camelCase names in
the implementation plan. Existing `/api/breeds` response shapes remain unchanged.

### User

The logical User combines verified Supabase Auth identity with `public.game_users`.
Email remains in Auth so an email change cannot leave a second copy out of sync.

| Application field | Storage | Rules |
| --- | --- | --- |
| `id` | `game_users.id` → `auth.users.id` | UUID primary/foreign key; no profile without an Auth identity |
| `username` | `game_users.username` | 3–24 ASCII letters, digits or underscores; unique ignoring case |
| `email` | Supabase Auth user email | Read from the verified identity in the future account service; never from request body game data |
| `coins` | `game_users.coins` | Integer, default 0, minimum 0 |
| `createdAt` | `game_users.created_at` | Finite timestamp with time zone, default database time |

Deleting an Auth user cascades to its game profile and pigeon. No demo account or
password is seeded. The phase 2 server creates the profile after verifying the
authenticated identity and handles retries/username conflicts. A foreign key establishes
identity existence; it does not itself prove that a request is authenticated or
that an email is confirmed.

### PigeonSpecies

`public.game_species` is a small, persistent projection of the existing catalogue
for the game, not a replacement taxonomy source.

| Application field | SQL column | Source/rules |
| --- | --- | --- |
| `id` | `id` | Existing `birdnet:BN...` ID; primary key |
| `name` | `name` | Existing common name |
| `scientificName` | `scientific_name` | Existing scientific name |
| `description` | `description` | Existing `history`, falling back to `fact` |
| `image` | `image` | Existing safe photo URL or existing local placeholder |
| `habitat` | `habitat` | Nullable; current source has no verified structured field |
| `diet` | `diet` | Nullable for the same reason |
| `rarity` | `rarity` | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| `isStarter` | `is_starter` | Server-controlled adoption eligibility |
| Source credits | `source_url`, `description_source`, `description_url`, `image_attribution` | Preserve source links, author, license and crop metadata |

Rarity is game balancing metadata, not conservation status. Three starters are
configured as common in `lib/game/species.js`:

| Existing ID | Existing name | Scientific name |
| --- | --- | --- |
| `birdnet:BN03514` | Rock Dove | Columba livia |
| `birdnet:BN03520` | Common Wood Pigeon | Columba palumbus |
| `birdnet:BN03516` | Stock Dove | Columba oenas |

The importer rejects missing/duplicate IDs, domestic breeds, changed scientific
names and missing source URLs. It performs no network requests and does not infer
habitat/diet from free text. Importing again refreshes source facts but preserves
curated habitat/diet, rarity, starter eligibility and all player data. Catalogue
imports cannot delete adopted species: their foreign key uses `ON DELETE RESTRICT`.

### UserPigeon

| Application field | SQL column | Initial value / rule |
| --- | --- | --- |
| `id` | `id` | Random database UUID |
| `userId` | `user_id` | Required profile reference; unique for the MVP |
| `speciesId` | `species_id` | Required game species reference |
| `nickname` | `nickname` | 1–32 characters, no outer spaces or control characters |
| `level` | `level` | 1, integer at least 1 |
| `xp` | `xp` | 0, nonnegative integer; XP within the current level |
| `hunger` | `hunger` | 100, numeric in [0, 100] |
| `happiness` | `happiness` | 100, numeric in [0, 100] |
| `energy` | `energy` | 100, numeric in [0, 100] |
| `cleanliness` | `cleanliness` | 100, numeric in [0, 100] |
| `health` | `health` | 100, numeric in [0, 100] |
| `growthStage` | `growth_stage` | `hatchling`; also allows `juvenile`, `adult`, `best_friend` |
| `createdAt` | `created_at` | Finite timestamp with time zone |
| `lastUpdated` | `last_updated` | Same initial database time; cannot precede creation |
| `version` | `version` | 0; nonnegative integer for later concurrency control |

The MVP allows one pigeon in total per account. A later multi-pigeon feature can
replace the unique user constraint with a partial unique index on active pigeons.
Stats retain four decimal places to support elapsed-time calculations. SQL rejects
out-of-range values and NaN; the later engine must clamp calculated values before
writing them. Zero health is valid and has no deletion/death behavior.

SQL only validates the growth-stage vocabulary in this phase. XP thresholds and
level-to-growth mapping are intentionally deferred to the central game service.

## Access and future action contract

All three tables have row-level security enabled. Anonymous visitors can read
species. Authenticated users can read species and only their own profile/pigeon.
Neither role can insert, update, delete or truncate game data, including its own
coins, XP or stats. The migration explicitly revokes permissive default grants.

Only trusted server code may write using `service_role` or a trusted database
connection. That role bypasses row security; **every future Node action must
verify the session and scope queries to that verified user ID**. Never expose a
privileged database key to the browser. Read policies are defense in depth, not a
substitute for authorization in server actions.

Later actions should lock the profile/pigeon rows in a consistent order inside one
database transaction, read database/server time, calculate decay, apply validated
effects, update stats/XP/coins/`last_updated`, and increment `version` together.
The schema does not increment `version` automatically. No cron, action endpoints,
cooldowns, rewards or engine have been implemented in this phase.

## Applying the schema

Prerequisite: a Supabase project (its Auth schema and roles must already exist).

1. Run `migrations/001_tamagotchi.sql` once with the database owner in the SQL editor
   or your migration tooling. It is transactional and deliberately fails if the
   tables already exist, rather than concealing schema drift.
2. Run `seeds/tamagotchi-starters.sql`. It is transactional and safe to repeat.
3. Configure Auth and the server integration in phase 2 before exposing game routes.

To regenerate the seed from the current bundled catalogue, without a database or
network access:

```bash
npm run seed:game -- --output seeds/tamagotchi-starters.sql
```

Without `--output`, the command prints SQL. It never connects to a database.
Do not run the existing `refresh:catalog` just to seed the game; that command
refreshes the complete source catalogue from upstream services.

## Verification

```bash
npm ci
npm test
# Focus on the new model:
npm run test:game
```

`@electric-sql/pglite` is a development dependency only. Tests execute the actual
migration and seed against an isolated in-memory PostgreSQL runtime. A small
test-only Auth schema supplies Supabase's `auth.users`/`auth.uid()` interface and
roles; this tests SQL constraints and policies, not the hosted authentication
service. Tests cover defaults, stat boundaries, fractions, invalid input,
uniqueness, foreign keys, SQL-safe source text, seed repeatability, access
isolation, client write denial, transactional rollback and account deletion.

No production data, legacy app database or real user credentials are used by
these new tests. Existing tests continue to run unchanged. Hosted migration,
Auth behavior and multi-connection contention need integration testing when the
database connection is introduced.

## Next phase

The account integration is implemented; Supabase still needs to be configured
and tested against the hosted service. Phase 3 adds adoption UI. The dashboard,
time decay, care actions, XP and coins follow separately.
Shop, inventory, discoveries, daily rewards, quests, achievements and minigames
remain outside the first MVP.
