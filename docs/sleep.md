# Rusten — fase 9

**Sleep** op `/my-pigeon` geeft meteen maximaal **30 Energy** en **5 Happiness**,
na het berekenen van het tijdsverloop. Beide waarden stoppen op 100. De speler
ziet de nieuwe balken en bijvoorbeeld “Pip feels rested!” met de werkelijke winst.
Sleep geeft geen XP of coins. Een uitgeputte duif kan hiermee weer spelen.

## Eenmalig activeren

1. Zorg dat migraties 001–006 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open het bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/007_sleep.sql` en klik **Run**.
4. Herstart de draaiende lokale server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon), klik **Sleep** en controleer
   de energie- en geluksbalk. Probeer daarna **Play**.

007 is lokaal getest en nog niet door de agent op Supabase uitgevoerd. Er zijn
geen nieuwe sleutels of accountinstellingen nodig. Bestaande duiven en voortgang
blijven behouden. Zonder de migratie toont Sleep een opslagfout, zonder alvast
herstel in de browser toe te kennen.

## Gedrag en opslag

- Sleep is een directe rustactie. Er is nog geen langdurige slaapstand of
  achtergrondproces. De gewone tijdsafname blijft gelden.
- Rusten werkt bij nul energie en bij volle balken. Op 100 is de statwinst nul.
  Health, level, groeifase, XP en coins veranderen niet door Sleep.
- De database bewaart `last_slept_at` en handhaaft 10 seconden tussen rustacties.
  De server begrenst verzoeken; de browser toont een aftelling.
- Alleen de geverifieerde sessie bepaalt de speler. De browser stuurt een UUID
  voor het verzoek, geen eigen stats, beloningen, tijdstippen of eigenaar.
- `sleep_game_pigeon` vergrendelt dezelfde duifrij als de andere verzorgingsacties
  en refresh. Het gebruikt de centrale tijdsberekening. Stats, tijdstempels en
  ontvangstbewijs worden in één transactie opgeslagen en bij fouten teruggedraaid.
- `game_sleep_receipts` voorkomt dubbel herstel bij herhaalde verzoeken. De browser
  bewaart de UUID in sessionStorage om veilig opnieuw te proberen na een onzekere
  verbindingsfout. Zonder sessionStorage blijft de UUID binnen de pagina beschikbaar.
  Een oude retry retourneert actuele stats zonder opnieuw herstel toe te passen.
- Ontvangstbewijzen zijn alleen voor de server toegankelijk en blijven bewaard.
  Account-/duifverwijdering ruimt ze op via foreign keys. Eventuele latere opruiming
  moet de bescherming tegen oude herhaalverzoeken behouden.
- De gedeelde dashboardfunctie negeert verouderde antwoorden. Een eerdere melding
  “too tired to play” verdwijnt zodra de nieuwste toestand voldoende energie bevat;
  verbindingsfouten blijven zichtbaar zodat opnieuw proberen mogelijk blijft.

Alle vier verzorgingsacties zijn gebouwd. Fase **10: [XP en levels](xp-levels.md)**
is inmiddels ook gebouwd. Groeifases en coins verdienen volgen later.

## Controle

Alle **99 tests** slagen met `npm test -- --test-reporter=dot`. Gericht testen kan
met `npm run test:sleep`. SQL-tests gebruiken PGlite met gesimuleerde Supabase
Auth/PostgREST en wijzigen geen echte accounts.

Getest: tijdsverloop vóór herstel, maxima 100, nul en volle energie, ongewijzigde
XP/coins, uitgeput → Sleep → Play, oude/dubbele verzoeken, cooldown, validatie,
accountisolatie, serverrechten, rollback, alle vier acties samen met refresh en
voortgang na opnieuw inloggen. De schermtest controleert dat alleen een achterhaalde
vermoeidheidsmelding verdwijnt. PGlite verwerkt verzoeken sequentieel; echte
PostgreSQL-lockcontentie is niet getest.

De browsercontrole bevestigt desktop en mobiel (390 pixels): Play weigert bij
ongeveer 5 energie, Sleep herstelt tot ongeveer 35 en daarna werkt Play weer.
XP blijft bij Sleep 27 en stijgt pas bij Play naar 37. De wachttijd en feedback
zijn zichtbaar.

```powershell
node test-support/preview-adoption.js --dashboard
```

De preview gebruikt een tijdelijke database; MobileBird begint met weinig energie.

## Bestanden in deze fase

- Nieuw: `migrations/007_sleep.sql`, `lib/game/sleep.js`, `public/pigeon-sleep.js`,
  `test/sleep.test.js` en dit document.
- Backend/dashboard: `lib/game/adoption.js`, `lib/game/pages.js`,
  `lib/auth/routes.js`, `server.js`, `public/pigeon-dashboard.css`.
- Achterhaalde melding: `public/pigeon-play.js`, `public/pigeon-care.js`,
  `test/care-view.test.js`.
- Tests/preview: `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `test/adoption.test.js`, `test/feed.test.js`, `test/play.test.js`,
  `test/clean.test.js`, `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/play.md`, `docs/clean.md`.
