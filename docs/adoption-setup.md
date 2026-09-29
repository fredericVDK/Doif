# Adoptie — fase 3

De speler kiest een Jacobin pigeon, Indian Fantail of Australian Saddleback Tumbler,
geeft de duif een naam en komt op `/my-pigeon`. De drie zijn bestaande rassen uit
`data/domestic-pigeons.json`, met `Columba livia` als bovenliggende soort.
De keuzekaarten tonen een echte foto, naam, wetenschappelijke naam, korte
catalogusbeschrijving, spelrariteit en bronverwijzingen. Alle drie starten gelijk.

## Eenmalige update van je bestaande Supabase-project

Je accountconfiguratie werkt al. Je hoeft geen nieuw project of nieuwe sleutels te maken.

1. Open je bestaande project in het [Supabase-dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor** en maak een nieuwe query.
3. Open `migrations/002_adoption.sql` in dit project en kopieer de volledige inhoud.
4. Plak die in de nieuwe query en klik **Run**. Voer dit bestand één keer uit.
   Het bestand bevat zowel de schema-aanpassing als de drie starterrassen.
5. Herstart de lokale server: druk **Ctrl+C** in de terminal waarin `npm start`
   draait, en voer daarna opnieuw `npm start` uit. Start geen tweede server op
   dezelfde poort; dat geeft `EADDRINUSE`.
6. Ga naar [de adoptiepagina](http://localhost:3037/adopt), meld je aan, kies een
   duif en geef hem een naam. Na opslaan verschijnt je duif op `/my-pigeon`.

Voor een lege database: voer eerst `migrations/001_tamagotchi.sql`, daarna
`seeds/tamagotchi-starters.sql` en dan `migrations/002_adoption.sql` uit.
Een fout in 002 rolt de volledige update terug. De eerdere drie soorten blijven
bewaard, maar worden geen starterkeuzes meer. Bestaande accounts, saldi en duiven
blijven intact. Als `kind already exists` verschijnt, controleer eerst of 002 al
succesvol is uitgevoerd; verwijder geen bestaande tabellen.

De instelling voor e-mailbevestiging hoeft voor deze fase niet te veranderen.
De applicatie volgt de Auth-instelling van je Supabase-project.

## Gedrag en garanties

- `/adopt` vereist een geldig account met profiel. Een bestaande eigenaar gaat
  meteen naar `/my-pigeon`; een account zonder duif gaat daar juist naar `/adopt`.
- `POST /api/game/adopt` accepteert `speciesId` en `nickname`. De server gebruikt
  de door Supabase geverifieerde gebruiker, nooit een ID uit het verzoek.
- Een naam bevat 1–32 Unicode-codepunten na trimmen, zonder controlekarakters.
  Namen worden als tekst weergegeven; HTML wordt ge-escaped.
- De databasefunctie vergrendelt het profiel en maakt één duif aan. De bestaande
  unieke beperking op `user_id` blijft gelden. Een identieke herhaling retourneert
  dezelfde duif; een andere tweede keuze geeft 409 en wijzigt geen voortgang.
- Level 1, XP 0, alle vijf stats 100, `hatchling`, versie 0 en tijdstempels komen
  uitsluitend uit de database. De adoptie verandert geen coins.
- Alleen de serverrol mag de functie uitvoeren. Clientwrites blijven geblokkeerd
  en RLS blijft actief. De service key komt nooit in browsercode of HTML terecht.
- Een opslagstoring geeft een fout met mogelijkheid tot opnieuw proberen; er is
  geen schijnbaar geslaagde lokale opslag of terugval naar de legacy JSON-database.
- Fotovermelding en licentielinks staan onder de foto. Bij een laadfout verschijnt
  een duidelijk als illustratie aangeduide fallback.

## Verificatie

```powershell
npm test
npm run test:adoption
```

De adoptietests voeren de echte migratie en SQL-functie in PGlite uit. De HTTP-tests
gebruiken de echte Supabase SDK met gesimuleerde Auth/PostgREST. Ze controleren
upgradebehoud, opslag, beginwaarden, identiteit, dubbele verzoeken, loginherstel,
validatie, clientrechten, RLS en opslagfouten. PGlite voert gelijktijdige verzoeken
intern sequentieel uit; echte PostgreSQL-concurrentie steunt daarnaast op de
profielvergrendeling en de unieke databasebeperking.

Voor een aparte handmatige browsercontrole zonder echte accounts:

```powershell
node test-support/preview-adoption.js
```

Dit toont een tijdelijke localhost-URL en testlogins. Het proces leest geen `.env`,
gebruikt alleen een database in geheugen en laadt uitsluitend de account- en
adoptiepagina's. Stop het proces na de controle. Publieke cataloguspagina's horen
niet bij deze testserver.

Alle 53 tests van `npm test` slagen. De volledige desktopflow en de mobiele
adoptieflow (390 × 844) zijn gecontroleerd, inclusief de echte foto's en het
opgeslagen eindscherm. De gehoste adoptie kan pas na uitvoering van 002 in
het echte Supabase-project worden getest. Er is tijdens deze fase geen echte
spelerduif aangemaakt.

## Bestanden in deze fase

- Database en import: `migrations/002_adoption.sql`, `scripts/seed-adoption.js`,
  `lib/game/starter-breeds.js`, `data/starter-photo-credits.json`.
- Server en pagina's: `lib/game/adoption.js`, `lib/game/pages.js`,
  `lib/auth/errors.js`, aanpassingen in `lib/auth/supabase.js`,
  `lib/auth/routes.js`, `lib/auth/pages.js` en de assetlijst in `server.js`.
- Interface: `public/adoption.css`, `public/adoption.js`.
- Verificatie: `test/adoption.test.js`, `test-support/auth-fixture.js`,
  `test-support/preview-adoption.js`, aangepaste `test/auth.test.js`.
- Handleiding en scripts: `README.md`, `docs/auth-setup.md`,
  `docs/tamagotchi-model.md`, dit document en `package.json`.

## Volgende fase

Fase 4 is inmiddels gebouwd: zie [het dashboard](dashboard.md). De gebruiker heeft
bevestigd dat de gehoste adoptie werkt. Voor het dashboard is geen extra SQL nodig.
