# Voeren — fase 6 en inventory-food (fase 27)

Op `/my-pigeon` opent **Feed** een voedselkeuze met gratis **Crumbs** en de Corn,
Peas of Sunflower Seeds die de speler bezit. De effecten komen uit de centrale
itemcatalogus. Elke maaltijd geeft daarnaast +5 XP en +2 coins. Statistieken
stoppen op 100.
Na opslaan sluiten we de voedselkeuze, werken de balken en XP bij en verschijnt
bijvoorbeeld “Gilbert enjoyed the crumbs!”. De melding toont de werkelijke winst.

## Eenmalig activeren

Migratie 003 is al aanwezig in het bestaande Supabase-project. De nieuwe kolom
voor Feed was bij de controle nog niet aanwezig. Migratie 004 is lokaal getest,
maar nog niet op het echte project uitgevoerd.

1. Open het bestaande Supabase-project → **SQL Editor** → nieuwe query.
2. Kopieer de volledige inhoud van `migrations/004_feed.sql` en klik **Run**.
   Voer dit bestand één keer uit, na de bestaande migraties 001–003.
3. Herstart de bestaande lokale server met Ctrl+C en daarna `npm start`.
4. Voer na de overige migraties ook `migrations/018_inventory_feeding.sql` één
   keer uit, na migratie 017.
5. Open [Mijn duif](http://localhost:3037/my-pigeon), kies **Feed** en geef
   Crumbs of een item uit je inventaris.

Er zijn geen nieuwe sleutels of accountinstellingen nodig. De bestaande duif en
voortgang blijven behouden. Zonder 004 kan de maaltijd niet worden opgeslagen;
de interface toont dan een fout en kent geen voorlopige beloning toe.

## Spelregels en opslag

- Crumbs zijn gratis. Corn, Peas en Sunflower Seeds kosten precies één exemplaar
  uit de eigen inventaris. Bij volle balken is de winst voor die statistiek 0.
- De database handhaaft 10 seconden tussen maaltijden. De server begrenst ook
  het aantal verzoeken. De browser toont tijdens de wachttijd een aftelling.
- De server bepaalt de speler via de geverifieerde sessie. De browser stuurt
  alleen de voedselkeuze en een UUID voor de maaltijd; eigen stats, tijdstippen,
  gebruikers-ID's en XP worden niet overgenomen.
- `feed_game_pigeon` vergrendelt dezelfde duifrij als de tijdsengine, berekent
  het tijdsverloop met `calculate_current_pigeon_state` en slaat voeding, XP,
  tijdstempels en een ontvangstbewijs in één transactie op.
- Een dubbel verzoek met dezelfde UUID telt één keer en verbruikt hoogstens één
  item. Na een verbindingsfout
  bewaart de browser de UUID in sessionStorage om veilig opnieuw te proberen.
  Een herhaald verzoek toont de huidige duif zonder opnieuw XP toe te kennen,
  ook als er inmiddels andere maaltijden waren. Zonder sessionStorage blijft
  deze bescherming binnen de geopende pagina beschikbaar.
- Ontvangstbewijzen zijn alleen toegankelijk voor de server en blijven bewaard.
  Account- of duifverwijdering ruimt ze via foreign keys op. Een toekomstige
  bewaartermijn moet de garantie voor oude herhaalverzoeken expliciet behouden.

De kleine browser-timer werkt alleen de aftelling bij; er zijn geen periodieke
database-updates. Health, level en groeifase veranderen niet door Feed.
Levelberekening volgt in fase 10. Fase **7: Play** is inmiddels gebouwd;
zie [spelen](play.md) voor de extra migratie en de huidige status.

## Verificatie

Alle **70 tests** slagen met `npm test -- --test-reporter=dot`. Gericht testen:
`npm run test:feed`. De tests gebruiken de echte migratie en SQL-functie in PGlite,
met gesimuleerde Supabase Auth/PostgREST, zonder echte accounts te wijzigen.

Getest: 48 uur tijdsverloop vóór voeding, maxima 100, XP-opslag na opnieuw
inloggen, dubbele en oude herhaalverzoeken, wachttijd, accountisolatie,
ongeldige invoer, cross-site verzoeken, serverrechten, samenloop met refresh
en volledige rollback wanneer het ontvangstbewijs niet kan worden opgeslagen.
PGlite voert databaseverzoeken sequentieel uit; echte PostgreSQL-lockcontentie
is daarmee niet getest. De productiecode gebruikt `FOR UPDATE` en één transactie.

Browsercontrole met een tijdelijke database bevestigt de voedselkeuze, stijging
van 27 naar 32 XP, actuele balken, succesmelding en uitgeschakelde knop tijdens
de wachttijd. De dialoog past op desktop en mobiele breedtes 390 en 320 pixels.
Escape sluit de dialoog en geeft de focus terug aan Feed.

```powershell
node test-support/preview-adoption.js --dashboard --away-48
```

## Bestanden in deze fase

- Nieuw: `migrations/004_feed.sql`, `lib/game/feed.js`, `public/pigeon-feed.js`,
  `test/feed.test.js` en dit document.
- Aangepast: `lib/game/adoption.js`, `lib/game/pages.js`, `lib/auth/routes.js`,
  `public/pigeon-dashboard.css` en `server.js` voor de actie, dialoog en feedback.
- Tests en preview: `test/adoption.test.js`, `test-support/auth-fixture.js`,
  `test-support/preview-adoption.js` en `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md` en `docs/time-engine.md`.
