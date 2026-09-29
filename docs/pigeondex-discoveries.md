# Persoonlijke PigeonDex — fase 13

De spelerscatalogus bevat uitsluitend records met een echte, toegelaten foto.
Met de huidige snapshots zijn dat 406 duiven: 269 soorten en 137 rassen. Records
met de algemene vervangingsafbeelding tellen niet mee en verschijnen niet in de
PigeonDex of dagelijkse ontdekking.

De bestaande PigeonDex is gekoppeld aan het account- en gamesysteem. Iedere
ingelogde speler heeft een eigen verzameling. Ontdekte duiven tonen hun echte
naam, foto, wetenschappelijke naam, informatie en bronvermelding uit de bestaande
BirdNET/Wikimedia-catalogus. Onontdekte duiven tonen alleen een vraagteken en of
het om een wilde soort of een gedomesticeerd ras gaat.

De teller gebruikt de catalogus die bij deze versie is gebundeld. Momenteel bevat
die **1.051 duiven: 350 wilde soorten en 701 gedomesticeerde rassen**. Wanneer de
catalogus later wordt bijgewerkt, past de teller zich automatisch aan.

## Eenmalig activeren

1. Zorg dat migraties 001–010 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/011_discoveries.sql` en klik **Run**.
4. Herstart de draaiende server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon). Je geadopteerde duif verschijnt
   als ontdekking. Open daarna [PigeonDex](http://localhost:3037/pigeondex.html)
   en kies **Discover today's pigeon**.

011 is lokaal getest en nog niet door de agent op Supabase uitgevoerd. Er zijn
geen nieuwe sleutels nodig. Voer deze migratie uit voordat je de nieuwe servercode
start, omdat de nieuwe pagina de ontdekkingstabel en functies gebruikt.

De migratie bewaart bestaande accounts, coins, stats, XP, levels en groeifases.
Voor iedere bestaande adoptie maakt ze één ontdekking aan met de oorspronkelijke
adoptiedatum. Nieuwe adopties krijgen hun ontdekking in dezelfde transactie. Als
het opslaan daarvan mislukt, wordt ook de adoptie teruggedraaid en kan ze veilig
opnieuw geprobeerd worden.

## Ontdekken

- Je geadopteerde starter telt automatisch mee.
- De dagelijkse duif kan eenmaal aan je verzameling worden toegevoegd.
- De dagelijkse keuze is voor iedereen gelijk en wisselt om **00:00 UTC**.
- De server bepaalt de datum en toegestane catalogus-ID. Een gewijzigde browserklok,
  meegestuurd account-ID of verzonnen duif kan geen ontdekking maken.
- Een dubbele klik of herhaald verzoek blijft één ontdekking.
- Ontdekkingen leveren in deze fase geen XP of coins op.

Na een nieuwe ontdekking verschijnt een toegankelijk venster met **NEW PIGEON
DISCOVERED**, foto, naam, wetenschappelijke naam, type, game-rarity,
bronvermelding en **View in PigeonDex**. Het venster verschijnt opnieuw na het
inloggen zolang de ontdekking nog niet bevestigd is. Na bevestiging blijft de
ontdekking bewaard, zonder het venster nogmaals te tonen.

De PigeonDex toont eerst 36 kaarten en heeft daarna **Show more pigeons**. Dit
houdt de pagina bruikbaar met meer dan duizend kaarten. Zoeken en filters blijven
onderdeel van de bestaande PigeonDex. Favorieten en lokale geschiedenis krijgen
een accountgebonden browsersleutel, zodat twee spelers in dezelfde browser die
niet vermengen.

## Opslag en beveiliging

`game_pigeon_discoveries` bewaart `user_id`, `species_id`, `discovered_at` en
`seen_at`. De combinatie van gebruiker en catalogus-ID is uniek. Verwijderen van
een profiel verwijdert de bijbehorende ontdekkingen automatisch.

De catalogus bevat ook rassen die niet als adopteerbare records in
`game_species` staan. Daarom bewaart de ontdekkingstabel de bestaande catalogus-ID
en valideert de Node-server die tegen de echte catalogus voordat hij de centrale
databasefunctie aanroept. De browser ontvangt voor onbekende duiven geen naam,
foto, wetenschappelijke naam, omschrijving of bron-URL.

RLS laat een ingelogde speler uitsluitend de eigen rijen lezen. Schrijven en de
centrale functies zijn alleen beschikbaar voor de serverrol. Alle API-antwoorden
zijn privé en `no-store`. Grote verzamelingen worden in pagina's van 500 rijen
opgehaald, zodat een volledige verzameling niet stil wordt afgekapt door de
standaardlimiet van PostgREST.

## Verificatie

Alle **135 tests** slagen met `npm test -- --test-reporter=dot`. Gericht:
`npm run test:discoveries`. De JavaScript-syntaxcontroles en `git diff --check`
slagen ook; de meldingen over toekomstige CRLF-regeluiteinden zijn geen fouten.

De tests controleren migratie en backfill, adoptie, beide catalogustypes,
onbekende kaarten zonder metadata, serverdatum en UTC-dagwissel, dubbele
verzoeken, vervalste velden, accountisolatie, opnieuw inloggen, bevestiging van
meldingen, opslagfouten, RLS/serverrechten, cascade-verwijdering, ontbrekende
catalogusrecords en verzamelingen groter dan 1.000 duiven.

Tests gebruiken echte SQL in PGlite met gesimuleerde Supabase Auth/PostgREST en
wijzigen geen echte accounts. De browsercontrole bevestigt de adoptie-ontdekking,
de link naar het bestaande detail, onbekende vraagtekenkaarten, de teller van
1/1.051 naar 2/1.051 en de dagelijkse ontdekking. Desktop en een mobiele breedte
van 390 pixels zijn gecontroleerd.

```powershell
node test-support/preview-adoption.js --dashboard
```

De preview gebruikt alleen een tijdelijke database in geheugen en toont de
testlogins in de terminal.

## Bestanden in deze fase

- Nieuw: `migrations/011_discoveries.sql`, `lib/game/discoveries.js`,
  `public/pigeon-discovery.js`, `public/pigeon-discovery.css`,
  `test/discoveries.test.js` en dit document.
- Backend: `lib/game/adoption.js`, `lib/auth/routes.js`, `server.js`.
- PigeonDex/dashboard: `public/pigeondex.html`, `public/pigeondex.js`,
  `public/catalog-ui.js`, `lib/game/pages.js`.
- Tests/preview: `test-support/auth-fixture.js`,
  `test-support/preview-adoption.js`, de bestaande gametests en `package.json`.
- Documentatie: `README.md`, `docs/dashboard.md`, `docs/coins.md`.

## Volgende fase

Ontdekken via minigames, locaties, achievements of andere activiteiten komt in
latere onderdelen. Fase 14 voegt de [dagelijkse beloning](daily-reward.md) toe;
een PigeonDex-ontdekking zelf geeft nog steeds geen coins of XP. De volgende
grote fase is **15: inventaris**.
