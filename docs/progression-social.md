# Progression, profiles and economy

Phase 37 deepens the progression loop and adds social profiles. Apply
`migrations/029_progression_social.sql` once after migration 028.

## Daily streak

The first reward is 50 coins and 20 XP. Consecutive UTC days increase the
reward; day seven awards 200 coins and 50 XP. Missing a day resets the streak.
The database calculates the date and persists every claim.

## Arena progression

Battles now expose Attack, Defense, Speed, a 12% critical chance, win/loss
record and ranks from Rookie through Legend. Difficulty, damage and rewards
grow with the pigeon level. A loss temporarily injures the pigeon; the player
can wait or pay for a clinic visit, which restores Health and clears the injury.

## PigeonDex and profiles

Signed-in favourites are stored in `game_pigeon_favorites` and may only refer
to discovered pigeons. The catalogue can filter by discovery state and rarity.
Every player gets `/profile` plus a shareable `/player/<username>` page. The
owner can make that page private at any time.

## Admin economy

The Account Admin dashboard shows coins in circulation, average and highest
balances, coin sources, and spending through the shop, packs and clinic. These
totals are calculated by a service-only database function; clients cannot
submit or alter economy totals.
