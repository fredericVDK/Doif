# Schoonmaken — fase 8

**Clean** op `/my-pigeon` maakt de duif schoon. Na het berekenen van tijdsverloop
geeft de actie maximaal **30 Cleanliness**, **5 Happiness** en **5 XP**. De balken
stoppen op 100. Na opslag verschijnt bijvoorbeeld “Gilbert feels fresh and clean!”
met de werkelijke winst, en worden de balken en XP direct bijgewerkt.

## Eenmalig activeren

1. Zorg dat de vorige migraties 001–005 zijn uitgevoerd. Herhaal geen geslaagde
   migraties.
2. Open het bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/006_clean.sql` en klik **Run**.
4. Herstart de draaiende lokale server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon) en klik **Clean**.
   Je krijgt 5 XP en ziet de opgeslagen netheid en geluk.

Migratie 006 is lokaal getest, maar nog niet door de agent op Supabase uitgevoerd.
Er zijn geen nieuwe sleutels of accountinstellingen nodig. De bestaande duif en
voortgang blijven behouden. Zonder de update wordt Clean met een opslagfout
afgewezen; de browser kent geen voorlopige beloning toe.

## Gedrag en opslag

- Clean is gratis en werkt ook bij nul energie. Het verandert geen energie of
  gezondheid, behalve de gewone daling van energie door verstreken tijd.
- Een volledig schone en gelukkige duif kan ook worden schoongemaakt. Dan is de
  statwinst 0 en de beloning 5 XP, zoals bij de bestaande Feed-actie.
- De database bewaart `last_cleaned_at` en handhaaft 10 seconden tussen wasbeurten.
  De browser toont een aftelling; de server begrenst daarnaast het aantal verzoeken.
- De geverifieerde sessie bepaalt de gebruiker. De browser stuurt alleen een UUID
  voor het verzoek en kan geen stats, beloningen, tijdstip of eigenaar kiezen.
- `clean_game_pigeon` vergrendelt dezelfde duifrij als Feed, Play en refresh en
  gebruikt de centrale tijdsberekening. Stats, XP, tijdstempels en ontvangstbewijs
  worden in één transactie opgeslagen. Een fout draait de hele actie terug.
- `game_clean_receipts` voorkomt dubbele beloningen bij dubbelklikken en opnieuw
  proberen na een verbindingsfout. De browser bewaart de UUID in sessionStorage;
  zonder opslag blijft die binnen de geopende pagina beschikbaar. Een oude retry
  toont de huidige duif zonder opnieuw een wasbeurt of XP toe te kennen.
- Ontvangstbewijzen zijn alleen voor de server toegankelijk en blijven bewaard.
  Verwijderen van een account of duif ruimt ze via foreign keys op. Een toekomstige
  bewaartermijn moet de bescherming voor oude herhaalverzoeken behouden.
- De bestaande `pigeon-care.js` voorkomt dat vertraagde antwoorden nieuwere
  statistieken in het dashboard overschrijven.

[Sleep](sleep.md) is inmiddels gebouwd in **fase 9** en herstelt energie na migratie 007.
Coins, levels, groeifases en inventaris zijn niet aan deze actie toegevoegd.

## Controle

Alle **89 tests** slagen met `npm test -- --test-reporter=dot`. Gericht testen kan
met `npm run test:clean`. De tests gebruiken de echte SQL in PGlite met gesimuleerde
Supabase Auth/PostgREST, zonder echte accounts of productiegegevens te wijzigen.

Getest: tijdsverloop vóór schoonmaken, nul en volle statistieken, nul energie,
statmaxima en daadwerkelijke winst, XP, herhaalde/oude verzoeken, cooldown,
invoer- en oorsprongcontrole, accountisolatie, serverrechten, rollback en samenloop
met Feed/Play/refresh. Voortgang blijft na af- en aanmelden beschikbaar. PGlite
voert verzoeken sequentieel uit; echte PostgreSQL-lockcontentie is niet getest.

De browsercontrole bevestigt de desktop- en mobiele weergave op 390 pixels,
de succesmelding, aftelling en beloningen: 45 → 75 Cleanliness, 72 → 77 Happiness
en 27 → 32 XP. Een tweede wasbeurt stopt op 100 en toont de kleinere statwinst.

```powershell
node test-support/preview-adoption.js --dashboard
```

Deze preview gebruikt alleen tijdelijke testdata. PreviewBird begint met 45 netheid;
MobileBird met 0 netheid en weinig energie.

## Bestanden in deze fase

- Nieuw: `migrations/006_clean.sql`, `lib/game/clean.js`, `public/pigeon-clean.js`,
  `test/clean.test.js` en dit document.
- Backend/dashboard: `lib/game/adoption.js`, `lib/game/pages.js`,
  `lib/auth/routes.js`, `server.js` en `public/pigeon-dashboard.css`.
- Tests/preview: `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `test/adoption.test.js`, `test/feed.test.js`, `test/play.test.js`, `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/play.md`.
