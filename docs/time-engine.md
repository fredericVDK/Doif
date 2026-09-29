# Tijdsverloop — fase 5

De duif krijgt actuele statistieken wanneer de speler `/my-pigeon` opent of
ververst, of `GET /api/game/pigeon` gebruikt. Er zijn geen cronjobs, achtergrondticks
of periodieke database-updates. De verstreken tijd sinds `last_updated` bepaalt
de daling, ook na meerdere dagen afwezigheid.

## Eenmalig activeren

1. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
2. Kopieer de volledige inhoud van `migrations/003_time_engine.sql` en klik **Run**.
   Deze update volgt op de al toegepaste migraties 001 en 002.
3. Herstart de lokale server: Ctrl+C en daarna `npm start`.
4. Open [Mijn duif](http://localhost:3037/my-pigeon). Bij openen worden de waarden
   berekend en opgeslagen. De percentages zijn afgerond op maximaal één decimaal.

Migratie 003 is inmiddels beschikbaar in het echte Supabase-project: bij de
controle voor fase 6 was de refresh-functie aanwezig. Voer 003 daar niet opnieuw
uit. Er zijn geen nieuwe sleutels of accountinstellingen nodig.
Voer de migratie één keer uit. Een ontbrekende migratie geeft een opslagfout; de
app toont dan geen schijnbaar bijgewerkte waarden.

De bestaande duif, coins, XP en tijdstempels blijven behouden bij de migratie.
Bij de eerste opening telt alle tijd sinds de laatste opgeslagen update mee.

## Regels

| Statistiek | Daling per uur | Na 48 uur vanaf 100 |
| --- | ---: | ---: |
| Hunger | 2 | 4 |
| Happiness | 1 | 52 |
| Energy | 1 | 52 |
| Cleanliness | 0,5 | 76 |
| Health | 0 | 100 |

Waarden blijven tussen 0 en 100. Afwezigheid verandert geen gezondheid, level,
XP, coins of groeifase. Een duif sterft of verdwijnt niet. De verzorgingsacties
waarmee lage waarden weer omhoog gaan, worden gebouwd in fases 6–9.

## Centrale berekening en opslag

`lib/game/engine.js` roept één serverfunctie aan: `refresh_game_pigeon`.
De Node-route geeft uitsluitend de geverifieerde gebruikers-ID door. De browser
kan geen tijdstip, dalingssnelheid of gewenste statwaarde instellen.

De SQL-functie vergrendelt de duifrij en leest vervolgens de databaseklok. Ze roept
`calculate_current_pigeon_state` aan, slaat de vier nieuwe waarden samen met
`last_updated` en `version` op, en retourneert precies de opgeslagen toestand
inclusief het catalogusrecord. Een tweede verzoek wacht op dezelfde rij en
rekent daarna alleen de nieuw verstreken tijd af. Een mislukte transactie rolt
statistieken en tijdstempel samen terug.

De zuivere berekeningsfunctie ontvangt een expliciet tijdstip voor reproduceerbare
tests. Beide functies zijn alleen uitvoerbaar door de serverrol. RLS en bestaande
clientbeperkingen blijven gelden. Bij een gelijke of eerdere kloktijd verandert
de toestand niet; een klokcorrectie kan dus geen stats verhogen of tijd terugzetten.

De vier dalende statistieken krijgen 12 decimalen in plaats van 4. Daardoor gaan
kleine tijdstappen niet verloren bij veelvuldig verversen. De maximale
afrondingsafwijking per opslag is een halve eenheid van de twaalfde decimaal.
De interface rondt alleen de weergave af en schrijft deze afronding niet terug.

Toekomstige verzorgingsacties moeten dezelfde berekeningsfunctie gebruiken binnen
hun eigen transactie, na het vergrendelen van dezelfde duifrij. Bereken geen tweede
verloopformule in de browser of in afzonderlijke actiehandlers.

## Verificatie

Alle **62 tests** slagen met `npm test`. Gericht testen kan met `npm run test:engine`.
Tests gebruiken de echte SQL in PGlite en gesimuleerde Supabase Auth/PostgREST:

- één uur, een half uur en 48 uur afwezigheid;
- zeer lange afwezigheid, ondergrens 0 en geen permanente dood;
- gelijke tijd, tijdzones en teruglopende klokken;
- 1.000 kleine updates met behoud van breukdelen;
- herhaalde verzoeken, consistente opgeslagen resultaten en rollback bij fouten;
- serverrechten, accountisolatie en genegeerde tijd/statvelden van de client;
- dashboard- en API-integratie.

PGlite verwerkt databaseverzoeken intern sequentieel. De tests bewijzen daardoor
geen echte PostgreSQL-lockcontentie; de productiegarantie steunt op `FOR UPDATE`
en de transactie waarin zowel de berekening als de opslag plaatsvinden.

De 48-uursterugkeer is ook via de browser gecontroleerd: 4/52/52/76 en gezondheid
100. Direct verversen rekende alleen de nieuw verstreken seconden af.
Dit gebruikte uitsluitend tijdelijke testaccounts en een database in geheugen:

```powershell
node test-support/preview-adoption.js --dashboard --away-48
```

## Bestanden

- Nieuw: `migrations/003_time_engine.sql`, `lib/game/engine.js`,
  `test/time-engine.test.js`, `docs/time-engine.md`.
- Aangepast: `lib/game/adoption.js`, `lib/auth/routes.js`, `lib/game/pages.js`,
  `test/adoption.test.js`, `test-support/auth-fixture.js`,
  `test-support/preview-adoption.js`, `package.json`, `README.md`,
  `docs/dashboard.md`, `docs/tamagotchi-model.md`.

Fase 6, **Feed**, is inmiddels gebouwd: eerst actuele stats berekenen, dan de
gekozen voeding toepassen, begrenzen en samen met XP opslaan. Zie [voeren](feed.md).
