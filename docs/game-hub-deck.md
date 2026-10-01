# Game Hub, Deck and Supabase community storage

Apply `migrations/034_game_hub_deck_and_community.sql` in the Supabase SQL Editor after migration 033. The migration keeps every existing pigeon and makes it team slot 1.

The authenticated game adds:

- a three-pigeon Deck built from discovered pigeons;
- per-pigeon care, XP, cooldowns, battle health and race progress;
- coin-funded Speed, Endurance, Strength and Navigation training;
- five story chapters with server-owned rewards;
- a monthly progress leaderboard and an in-game notification inbox;
- Supabase tables for the classic feeder scores and community drawings.

Set `COMMUNITY_STORAGE=supabase` in Vercel. Existing Supabase URL, publishable key and secret key are reused; Airtable variables are no longer required for new data.

To copy old Airtable content once, temporarily put the old Airtable variables in the local `.env` and run `npm run migrate:airtable`. After a successful import, remove those variables and disconnect Airtable.
