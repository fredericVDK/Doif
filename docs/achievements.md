# Achievements (phase 19)

Achievements are permanent milestones for a signed-in pigeon account:

| Achievement | Requirement | Reward |
| --- | --- | ---: |
| First Crumb | Feed the pigeon once | 25 coins + 10 XP |
| Pigeon Parent | Reach level 10 | 100 coins + 50 XP |
| Bird Nerd | Discover 25 species or breeds | 150 coins + 75 XP |
| Best Friends | Reach the Best Friend growth stage | 250 coins + 100 XP |
| Collector | Own 10 different item types | 100 coins + 50 XP |
| Arena Regular | Complete 10 pigeon battles | 150 coins + 75 XP |
| Pack Opener | Open 10 Pigeon Packs | 200 coins + 100 XP |
| Clinic Friend | Visit the Pigeon Clinic 5 times | 125 coins + 60 XP |
| Crumb Champion | Complete 10 Catch the Crumbs rounds | 150 coins + 75 XP |
| Master Birder | Discover 100 pigeons | 300 coins + 150 XP |
| Crumb Connoisseur | Feed the pigeon 50 times | 125 coins + 60 XP |
| Devoted Caretaker | Complete 100 care actions | 250 coins + 125 XP |
| Seasoned Pigeon | Reach level 20 | 250 coins + 125 XP |
| Arena Veteran | Complete 50 pigeon battles | 350 coins + 175 XP |
| Pack Collector | Open 25 Pigeon Packs | 400 coins + 200 XP |
| Clinic Regular | Visit the Pigeon Clinic 15 times | 300 coins + 150 XP |
| Crumb Legend | Complete 50 Catch the Crumbs rounds | 350 coins + 175 XP |
| Pigeon Scholar | Discover 250 pigeons | 600 coins + 300 XP |
| Nest Egg | Save 2,500 Pigeon Coins | 250 coins + 125 XP |
| Legendary Companion | Reach level 50 | 1,000 coins + 500 XP |

The **My Pigeon** dashboard shows current progress, locked milestones, unlocked
rewards, and claimed rewards. Progress comes from authoritative saved records:
feed receipts, pigeon level and growth stage, PigeonDex discoveries, and positive
inventory quantities, battle and pack receipts, clinic visits and completed
minigame rounds. Client-supplied progress and reward amounts are ignored.

Unlocks never expire. Reward claims lock the pigeon and achievement row, award
coins and XP in the same transaction, and save `claimed_at`. Concurrent or
repeated claims therefore pay once. An XP reward can unlock another level-based
achievement, which appears immediately.

## Supabase setup

Run `migrations/016_achievements.sql` once in the Supabase SQL Editor after
`015_daily_quests.sql`. It preserves existing data and adds the achievement
table, own-read RLS policy, server-only progress synchronization, and atomic
claim function. Existing progress is recognized the next time achievements load;
the migration itself does not grant rewards.

After migration 024, run `migrations/025_more_quests_achievements.sql` once to
add the five newer milestones. Saved progress is recognized on the next load.

After migration 025, run `migrations/026_more_permanent_achievements.sql` once
to expand the list to 20 milestones. Existing care receipts, levels, battles,
packs, clinic visits, completed minigames, discoveries and the current wallet
balance count immediately; rewards still require an explicit claim.

The authenticated routes are:

- `GET /api/game/achievements`
- `POST /api/game/achievements/claim` with
  `{ "achievementId": "first_crumb" }`

POST claims use the existing same-origin protection and rate limiting.

Phase 20 adds the first server-validated minigame:
[Catch the Crumbs](catch-the-crumbs.md).
