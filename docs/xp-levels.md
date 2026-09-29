# XP en levels — fase 10

Feed, Play en Clean gebruiken nu één centrale XP-berekening in de database.
Het dashboard toont level, XP binnen het huidige level en een balk naar het
volgende level. Bij een verhoging verschijnt bijvoorbeeld “Gilbert reached Level 2!”.

## Eenmalig activeren

1. Zorg dat migraties 001–007 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/008_xp_levels.sql` en klik **Run**.
4. Herstart de draaiende server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon). Je ziet je level en de
   XP-balk. Feed, Play en Clean laten deze vooruitgaan.

008 is lokaal getest en nog niet door de agent uitgevoerd op Supabase. Er zijn
geen nieuwe sleutels nodig. Deze migratie verwerkt eerder verdiende XP meteen:
je duif kan dus bij de eerste opening al een hoger level hebben. De historische
verhoging door de migratie krijgt geen tijdelijke level-upmelding; die verschijnt
bij verhogingen die het geopende dashboard ontvangt.

## Regels

- Feed: **5 XP**. Play: **10 XP**. Clean: **5 XP**. Sleep: **geen XP**.
- Voor het volgende level is **100 × het huidige level** nodig: 100 XP van 1 naar
  2, daarna 200 van 2 naar 3, daarna 300 van 3 naar 4.
- `xp` blijft, zoals voorzien in het oorspronkelijke model, de voortgang binnen
  het huidige level. Het is geen levenslang totaal. Na een level-up loopt het
  zichtbare getal terug en gaat alle resterende XP mee naar het volgende level.
- Voorbeeld: level 1 met 95 XP plus Play wordt level 2 met 5/200 XP.
- Meerdere levels in één keer werken ook: level 1 met 650 XP wordt level 4 met
  50/400 XP. Bestaande hogere levels worden behouden en overtollige XP verwerkt.
- Level-ups veranderen geen stats of coins. Sinds fase 11 bepaalt het level ook
  de [groeifase](growth-stages.md), via migratie 009. Sinds fase 12 geven de
  verzorgingsacties ook [coins](coins.md), via migratie 010. Dagelijkse XP hoort
  bij de latere dagelijkse beloning.

## Centrale logica en opslag

`pigeon_xp_required(level)` bepaalt de drempel. `pigeon_xp_reward(action)` bepaalt
de XP-beloning. De zuivere helper `add_pigeon_xp(pigeon, amount)` verwerkt XP,
levelgrenzen en resterende XP. Ze zijn alleen uitvoerbaar door de serverrol.
Er is geen publiek endpoint waarmee een speler zelf XP kan toevoegen.

Migratie 008 vervangt de bestaande Feed-, Play- en Clean-functies zodat ze de
helper aanroepen binnen hun bestaande transactie, terwijl ze de duifrij vergrendeld
houden. Stats, XP, level en ontvangstbewijs worden samen opgeslagen of teruggedraaid.
Oude ontvangstbewijzen blijven geldig: opnieuw proberen retourneert de huidige
duif en kent geen tweede beloning toe.

De database levert `xp_to_next_level` als gegenereerde kolom op basis van dezelfde
drempelfunctie. De server rendert de voortgangsbalk; de browser berekent geen levels
of beloningen. Het versienummer voorkomt dat vertraagde antwoorden nieuwere
voortgang overschrijven. Een herhaald antwoord met hetzelfde level herhaalt de
level-upmelding niet.

De migratie normaliseert bestaande XP zonder stats of `last_updated` te veranderen,
zodat verstreken tijd bij het volgende bezoek nog wordt meegerekend. Alleen rijen
met voldoende XP veranderen van level/XP en krijgen een hogere versie.

## Verificatie

Bij oplevering van fase 10 slaagden alle **107 tests** met
`npm test -- --test-reporter=dot`. Fase 11 breidt dit uit naar **116 tests**. Gericht:
`npm run test:xp`. Getest zijn grenzen, resterende XP, meerdere levels, bestaande
levels, migratie met oude ontvangstbewijzen, alle verzorgingsacties, geen XP voor
Sleep/verversen, dubbele verzoeken, gelijktijdige acties, rollback, serverrechten,
opslag na opnieuw inloggen en meldingen bij vertraagde/herhaalde antwoorden.

Tests gebruiken echte SQL in PGlite met gesimuleerde Supabase Auth/PostgREST.
Ze wijzigen geen echte accounts. PGlite verwerkt verzoeken sequentieel; echte
PostgreSQL-lockcontentie is niet getest. De productiecode gebruikt rijlocks.

De browsercontrole bevestigt 95 XP → Play → level 2 met 5/200 XP en de
level-upmelding. De voortgang blijft na opnieuw openen behouden en past op
een mobiel scherm van 390 pixels.

```powershell
node test-support/preview-adoption.js --dashboard --level-up
```

Deze geïsoleerde preview begint met 95 XP in een tijdelijke database.

## Bestanden in deze fase

- Nieuw: `migrations/008_xp_levels.sql`, `test/xp.test.js`, dit document.
- Dashboard/API: `lib/game/pages.js`, `lib/auth/routes.js`,
  `public/pigeon-care.js`, `public/pigeon-dashboard.css`.
- Tests/preview: `test/care-view.test.js`, `test/adoption.test.js`,
  `test/feed.test.js`, `test/play.test.js`, `test/clean.test.js`,
  `test/sleep.test.js`, `test-support/preview-adoption.js`, `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/sleep.md`.
