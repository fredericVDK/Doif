# Groeifases — fase 11

Je duif groeit mee met zijn opgeslagen level. Het dashboard toont de huidige
groeifase als badge en meldt een nieuwe fase meteen na een level-up.

| Level | Groeifase |
| --- | --- |
| 1–4 | Hatchling |
| 5–9 | Juvenile |
| 10–24 | Adult |
| 25 en hoger | Best Friend |

## Eenmalig activeren

1. Zorg dat migraties 001–008 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/009_growth_stages.sql` en klik **Run**.
4. Herstart de draaiende server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon). De badge past bij je level.

009 is lokaal getest en nog niet door de agent uitgevoerd op Supabase. Er zijn
geen nieuwe sleutels nodig. Bestaande duiven krijgen bij de migratie meteen de
juiste groeifase. Alleen een afwijkende groeifase en het bijbehorende versienummer
veranderen; XP, level, stats en `last_updated` blijven behouden. Verstreken tijd
blijft dus meetellen bij je volgende bezoek. Deze historische correctie toont
geen tijdelijke groeimelding.

## Gedrag en opslag

De databasefunctie `get_pigeon_growth_stage(level)` bevat alle levelgrenzen.
De trigger `sync_pigeon_growth_stage` gebruikt die functie bij adoptie en bij
elke opgeslagen wijziging van level of groeifase. De centrale XP-helper geeft
ook meteen de juiste groeifase terug, zelfs wanneer meerdere levels tegelijk
worden bereikt. De browser toont het serverresultaat en berekent geen groeifases.

Verzorgingsacties bewaren stats, XP, level, groeifase en ontvangstbewijs in dezelfde
transactie. Bij een fout wordt alles teruggedraaid. Opnieuw proberen met hetzelfde
verzoeknummer geeft de huidige duif terug zonder een tweede beloning. Vertraagde
antwoorden overschrijven geen nieuwere voortgang en herhalen de groeimelding niet.
Spelers kunnen geen eigen level of groeifase instellen.

Groei kent geen extra XP, statbonus of coins toe. Tijd alleen laat een duif niet
groeien. De bestaande rasfoto blijft behouden; aparte afbeeldingen per leeftijd
komen later. Sinds [fase 12](coins.md) verdienen Feed, Play en Clean coins;
de groeifase zelf geeft geen extra bonus.

## Verificatie

Bij oplevering van fase 11 slaagden alle **116 tests** met
`npm test -- --test-reporter=dot`. Fase 12 breidt dit uit naar **125 tests**. Gericht:
`npm run test:growth`. De tests controleren alle levelgrenzen, ongeldige levels,
adoptie, meerdere levels tegelijk, Feed/Play/Clean bij een groeigrens, migratie van
bestaande duiven, oude ontvangstbewijzen, dubbele verzoeken, rollback, rechten,
opslag na opnieuw inloggen en meldingen bij herhaalde/vertraagde antwoorden.

Tests gebruiken echte SQL in PGlite met gesimuleerde Supabase Auth/PostgREST.
Ze wijzigen geen echte accounts. PGlite verwerkt verzoeken sequentieel; echte
PostgreSQL-lockcontentie is niet getest. De bestaande verzorgingsfuncties gebruiken
rijlocks.

De browsercontrole bevestigt Clean bij 395/400 XP: level 4 → 5, 0/500 XP,
Juvenile-badge en groeimelding. Op 390 pixels breed bevestigt Clean bij
2.395/2.400 XP: level 24 → 25, Best Friend-badge en een passende melding.

```powershell
node test-support/preview-adoption.js --dashboard --growth
```

Deze geïsoleerde preview gebruikt een tijdelijke database in geheugen en toont
de URL en testlogins in de terminal. Beide testduiven beginnen vlak voor een
groeigrens; Clean levert de laatste 5 XP.

## Bestanden in deze fase

- Nieuw: `migrations/009_growth_stages.sql`, `test/growth.test.js`, dit document.
- Dashboard/API: `lib/game/pages.js`, `lib/auth/routes.js`,
  `public/pigeon-care.js`, `public/pigeon-dashboard.css`.
- Tests/preview: `test/care-view.test.js`, `test/adoption.test.js`,
  `test/feed.test.js`, `test/play.test.js`, `test/clean.test.js`,
  `test/sleep.test.js`, `test/xp.test.js`, `test-support/preview-adoption.js`,
  `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/xp-levels.md`.
