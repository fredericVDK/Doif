# Pigeon Coins — fase 12

Verzorgingsacties verdienen nu coins. Het saldo bovenaan het dashboard wordt
meteen bijgewerkt en blijft na uitloggen en opnieuw inloggen behouden.

| Actie | Coins per geslaagde actie |
| --- | --- |
| Feed (Crumbs) | +2 |
| Play | +5 |
| Clean | +2 |
| Sleep | 0 |

## Eenmalig activeren

1. Zorg dat migraties 001–009 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/010_coins.sql` en klik **Run**.
4. Herstart de draaiende server met Ctrl+C en daarna `npm start`.
5. Herlaad [Mijn duif](http://localhost:3037/my-pigeon). Noteer je saldo en probeer
   Feed, Play en Clean. Samen leveren ze 9 coins op; Play vereist minstens 10 Energy.

010 is lokaal getest en nog niet door de agent op Supabase uitgevoerd. Er zijn
geen nieuwe sleutels nodig. Voer de migratie uit voordat je de nieuwe servercode
start: profielqueries lezen vanaf deze versie ook `coins_version`.

Bestaande coins, duiven en voortgang blijven behouden. Er is geen beloning met
terugwerkende kracht voor eerdere acties. Een nieuwe speler begint nog steeds
met 0 coins. Crumbs blijven gratis.

## Centrale backendlogica

`pigeon_coin_reward(action)` bepaalt de bedragen. `award_pigeon_coins(user, action)`
telt de beloning op bij het opgeslagen saldo en verhoogt `coins_version`.
`get_pigeon_wallet(user)` levert het actuele saldo met die versie. Deze functies
zijn alleen uitvoerbaar door de serverrol; er is geen publiek endpoint om zelf
coins toe te voegen. Door de browser meegestuurde bedragen of gebruikers-ID's
worden niet gebruikt.

De bestaande Feed-, Play- en Clean-functies kennen coins pas toe nadat ze het
verzoek, de duif, cooldown en eventuele energievoorwaarde hebben gecontroleerd.
Ze vergrendelen eerst de duifrij; de saldo-update vergrendelt ook het profiel.
Coins, stats, XP, level, groeifase en ontvangstbewijs vallen onder dezelfde
transactie. Een opslagfout draait alles terug. Ook een overschrijding van het
bestaande integerbereik van het saldo breekt de hele actie af.

Een herhaald verzoek met hetzelfde verzoeknummer kent geen tweede beloning toe.
Het antwoord bevat het actuele saldo, naast de oorspronkelijke effecten. Oude
ontvangstbewijzen zonder coinbeloning blijven geldig en rapporteren 0 coins.
Een nieuwe actie na de bestaande cooldown kan opnieuw coins verdienen, ook als
de verzorgde stats al vol zijn. De bestaande requestlimieten blijven gelden.

De frontend toont het opgeslagen saldo in plaats van zelf coins op te tellen.
Het saldo heeft een eigen versienummer, zodat vertraagde antwoorden geen nieuwer
saldo overschrijven. Ook als een Sleep-antwoord eerder aankomt dan een vorige
Feed-beloning, verschijnt die beloning alsnog correct.

## Verificatie

Alle **125 tests** slagen met `npm test -- --test-reporter=dot`. Gericht:
`npm run test:coins`. JavaScript-syntaxcontroles slagen ook; dit project heeft
geen afzonderlijke lint-, typecheck- of buildstap.

De tests controleren de bedragen, gewijzigde clientvelden, accountisolatie,
dubbele en gelijktijdig aangeboden acties, actuele saldi bij herhalen, cooldowns,
te weinig energie, rollback bij opslagfouten, saldo-overflow, serverrechten,
oude ontvangstbewijzen, behoud van bestaande saldi en opslag na opnieuw inloggen.
Sleep, verversen en level-ups geven geen extra coins.

Tests gebruiken echte SQL in PGlite met gesimuleerde Supabase Auth/PostgREST en
schrijven geen testdata naar Supabase. PGlite verwerkt verzoeken sequentieel;
echte PostgreSQL-lockcontentie is niet getest. De productiecode gebruikt rijlocks.

De browsercontrole bevestigt 48 → 50 na Clean, → 55 na Play en → 57 na Feed,
inclusief de coinmeldingen en een gelijktijdige overgang naar Juvenile. Na
herladen blijft 57 behouden. De weergave is gecontroleerd op desktop en op een
mobiele breedte van 390 pixels.

```powershell
node test-support/preview-adoption.js --dashboard --growth
```

Deze preview gebruikt alleen een tijdelijke database in geheugen en toont de
testlogins in de terminal.

## Bestanden in deze fase

- Nieuw: `migrations/010_coins.sql`, `test/coins.test.js`, dit document.
- Profiel/dashboard: `lib/auth/supabase.js`, `lib/game/pages.js`.
- Browser: `public/pigeon-care.js`, `public/pigeon-feed.js`,
  `public/pigeon-play.js`, `public/pigeon-clean.js`.
- Tests/preview: `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `test/care-view.test.js`, `test/adoption.test.js`, `test/feed.test.js`,
  `test/play.test.js`, `test/clean.test.js`, `test/sleep.test.js`,
  `test/xp.test.js`, `test/growth.test.js`, `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/growth-stages.md`,
  `docs/xp-levels.md`.

## Nog niet geïmplementeerd

Coins uit dagelijkse login, achievements of minigames en een winkel om coins
uit te geven horen bij latere onderdelen. Level-ups krijgen in deze MVP geen
extra coinbonus. Sinds fase 13 is de [persoonlijke PigeonDex](pigeondex-discoveries.md)
beschikbaar; ontdekkingen geven geen coins. De volgende grote fase is
**14: dagelijkse beloning**.
