# Spelen — fase 7

**Play** op `/my-pigeon` voert direct een verzorgingsactie uit. Eerst rekent de
database de verstreken tijd af. Met minstens 10 actuele Energy kost spelen
10 Energy en geeft het maximaal 15 Happiness en 10 XP. Happiness stopt op 100.
De speler ziet de bijgewerkte balken, XP en een succesmelding.

Bij minder dan 10 Energy verschijnt bijvoorbeeld “Gilbert is too tired to play.”
Alleen het tijdsverloop wordt dan opgeslagen; er worden geen energie of beloningen
voor een spelactie geboekt. Ook de getoonde balken worden bijgewerkt.

## Eenmalig activeren

1. Zorg dat de vorige migraties 001–004 zijn uitgevoerd. Geslaagde migraties
   hoef je niet opnieuw uit te voeren.
2. Open het bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/005_play.sql` en klik **Run**.
4. Herstart de draaiende lokale server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon) en klik **Play**.
   Met voldoende energie zie je 10 extra XP, meer geluk en minder energie.

005 is lokaal getest en nog niet door de agent uitgevoerd op Supabase. De actuele
hosted schema-status kon deze beurt wegens een verbindingsfout niet worden
geverifieerd. Er zijn geen nieuwe sleutels of accountinstellingen nodig.

## Opslag en bescherming

- De geverifieerde sessie bepaalt de speler; de client kan alleen een verzoek-ID
  sturen. Energie, beloningen, tijdstip en gebruikers-ID komen van de server.
- `play_game_pigeon` vergrendelt dezelfde duifrij als Feed en refresh. Het gebruikt
  de centrale tijdsberekening en slaat de actie en het ontvangstbewijs in één
  transactie op. Een mislukte opslag draait ook energie, XP en tijdsverloop terug.
- De database bewaart `last_played_at` en dwingt 10 seconden tussen spellen af.
  Een aparte serverlimiet begrenst verzoeken. De browser toont een aftelling.
- Dubbelklikken en opnieuw proberen na een onzekere verbindingsfout tellen één
  keer dankzij de UUID en `game_play_receipts`. Oude herhaalverzoeken retourneren
  actuele stats zonder opnieuw energie af te trekken of XP te geven.
- Ontvangstbewijzen zijn alleen toegankelijk voor de server, blijven bewaard en
  verdwijnen via foreign keys bij account-/duifverwijdering. Zoals bij Feed moet
  eventuele latere opruiming de bescherming voor oude verzoeken behouden.
- Feed en Play delen de weergavefunctie in `pigeon-care.js`. Het versienummer
  voorkomt dat een vertraagd antwoord nieuwere statistieken overschrijft.

Er zijn geen minigame, coins of levelverhogingen toegevoegd. [Clean](clean.md) is
inmiddels gebouwd in fase 8. [Sleep](sleep.md) is gebouwd in fase 9 en herstelt
energie na migratie 007, zodat een vermoeide duif weer kan spelen.

## Verificatie

Alle **80 tests** slagen met `npm test -- --test-reporter=dot`, inclusief de
bestaande suite, Play en de bescherming tegen verouderde schermupdates.
Gericht: `npm run test:play`. SQL-tests gebruiken PGlite met gesimuleerde
Supabase Auth/PostgREST, zonder echte accounts te wijzigen.

Getest zijn 48 uur afwezigheid vóór spelen, precies 10 energie, te weinig/geen
energie, Happiness op 100, dubbele en oude verzoeken, cooldown, accountisolatie,
invoer en origin-controle, serverrechten, rollback, samenloop van Feed/Play/refresh
en voortgang na af- en aanmelden. Een aparte test controleert de weergave bij
antwoorden die in de verkeerde volgorde arriveren. PGlite verwerkt verzoeken
sequentieel; echte PostgreSQL-lockcontentie is niet getest.

In de geïsoleerde browserpreview is succesvol spelen gecontroleerd (27 → 37 XP,
54 → 44 Energy, 72 → 87 Happiness), gevolgd door Feed (42 XP). Ook de wachttijd
en de melding voor een vermoeide duif zijn gecontroleerd, inclusief mobiel.

```powershell
node test-support/preview-adoption.js --dashboard
```

PreviewBird heeft voldoende energie; MobileBird heeft weinig energie. De preview
gebruikt uitsluitend een tijdelijke database in geheugen.

## Bestanden in deze fase

- Nieuw: `migrations/005_play.sql`, `lib/game/play.js`, `public/pigeon-play.js`,
  `public/pigeon-care.js`, `test/play.test.js`, `test/care-view.test.js`, dit document.
- Backend/dashboard: `lib/game/adoption.js`, `lib/game/pages.js`,
  `lib/auth/routes.js`, `server.js`, `public/pigeon-dashboard.css`,
  `public/pigeon-feed.js`.
- Testondersteuning: `test-support/auth-fixture.js`,
  `test-support/preview-adoption.js`, `test/adoption.test.js`, `test/feed.test.js`,
  `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/feed.md`.
