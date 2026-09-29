# Duivendashboard — fase 4

`/my-pigeon` is nu het centrale scherm voor de geadopteerde duif. Het toont de
naam, het ras, de foto met bronvermelding, de opgeslagen groeifase, level, XP en
het coinsaldo van de ingelogde speler. De vijf statistieken verschijnen als
toegankelijke balken met percentages en tekstlabels: Health, Hunger, Happiness,
Energy en Cleanliness. Een hoge Hunger-waarde betekent een volle maag.

Het scherm gebruikt de bestaande Node-templates, HTML en CSS. De server haalt de
duif en het profiel op via de geverifieerde Supabase-identiteit. Sinds fase 5
berekent en bewaart herladen ook de inmiddels verstreken tijd; zie
[tijdsverloop](time-engine.md). Er staan geen testwaarden in de echte pagina.

## Bekijken

1. Herstart de bestaande server met Ctrl+C en daarna `npm start`.
2. Open [My pigeon](http://localhost:3037/my-pigeon) en meld je aan.
3. Je bestaande adoptie verschijnt met de bijbehorende waarden.

De gebruiker heeft bevestigd dat migratie 002 en adoptie in Supabase werken.
Voor fase 4 was geen extra SQL nodig. Fase 5 voegt migratie 003 toe.

## Grenzen van deze fase

Sinds fase 6 opent Feed de voedselkeuze en kun je Crumbs geven; zie
[voeren](feed.md) voor de benodigde migratie 004. Sinds fase 7 werkt ook
[Play](play.md), na migratie 005. Sinds fase 8 werkt [Clean](clean.md), na migratie
006. Sinds fase 9 werkt ook [Sleep](sleep.md), na migratie 007: alle vier acties
zijn beschikbaar. Fase 5 voegt de centrale berekening van verloop
door verstreken tijd toe bij het openen/verversen. Sinds fase 10 werken
[XP en levels](xp-levels.md) via migratie 008, inclusief een voortgangsbalk en
melding bij het bereiken van een nieuw level. Sinds fase 11 verandert de
[groeifase](growth-stages.md) automatisch bij levels 5, 10 en 25, na migratie 009.
De badge en groeimelding worden direct bijgewerkt na een verzorgingsactie.
Sinds fase 12 leveren Feed, Play en Clean ook [coins](coins.md) op, na migratie
010. Het saldo bovenaan het dashboard verandert meteen mee.
Sinds fase 13 wordt de geadopteerde duif automatisch toegevoegd aan de
[persoonlijke PigeonDex](pigeondex-discoveries.md), na migratie 011. Een nieuwe
ontdekking verschijnt ook bij het dashboard zolang de melding nog niet bevestigd is.
Sinds fase 14 claimt het eerste dashboardbezoek van elke UTC-dag automatisch de
[dagelijkse beloning](daily-reward.md), na migratie 012. Coins, XP, level en
groeifase worden meteen bijgewerkt voordat het beloningsvenster verschijnt.
Sinds fase 15 staat **Inventory** in de accountnavigatie. De
[inventarispagina](inventory.md) toont vier voedselitems en de eigen aantallen,
na migratie 013. Sinds migratie 018 toont Feed ook de eigen Corn, Peas en
Sunflower Seeds en wordt één gekozen item atomair verbruikt.
Sinds fase 16 staat ook de [Shop](shop.md) in de accountnavigatie, na migratie
014. Aankopen verminderen het coinsaldo en verhogen de inventaris atomair.
Sinds fase 17 gebruiken dashboard, accountpagina’s en publieke pagina’s dezelfde
[responsive navigatie](navigation.md). Hiervoor is geen extra migratie nodig.
Sinds fase 21 heeft het dashboard een centrale, toestandgevoelige roost-scene,
subtiele verzorgingsanimaties en snelle kaarten voor Inventory en Shop; zie
[UI/UX](ui-ux.md). Hiervoor is geen extra migratie nodig.

De tekstlabels bij statistieken zijn uitsluitend visuele uitleg: onder 30 laag,
30–69 gemiddeld en vanaf 70 hoog. Dit zijn geen nieuwe spelregels of beloningen.
Bij ongeldige of ontbrekende waarden toont het scherm een onbekende waarde.

## Controle

Resultaat: alle 54 tests slagen. Het dashboard is visueel gecontroleerd op desktop
en op mobiele breedtes van 390 en 320 pixels, inclusief lage waarden, een lege
hongerbalk, percentages en de uitgeschakelde actieknoppen.

`npm test` controleert de bestaande routes, authenticatie, adoptie, SQL-beperkingen
en het dashboard. De dashboardtest gebruikt echte SQL in PGlite met gesimuleerde
Supabase Auth/PostgREST. Die controleert onder meer afwijkende statwaarden,
0 en 100, afronding, coins, ge-escapete namen, accountisolatie en het uitblijven
van wijzigingen na herladen. Testdata worden niet naar Supabase geschreven.

Handmatige browsercontrole kan afzonderlijk met:

```powershell
node test-support/preview-adoption.js --dashboard
```

Deze testserver gebruikt alleen een tijdelijke database in geheugen. Hij toont
een URL en logingegevens voor twee testaccounts: één met gemengde gezonde waarden
en één met lage waarden. Zonder `--dashboard` blijft de oorspronkelijke
adoptiepreview beschikbaar.

## Bestanden

- `lib/game/pages.js`: dashboardtemplate, statbalken en opmaak van opgeslagen waarden.
- `lib/auth/routes.js`: geeft het eigen profiel en coinsaldo aan de template door.
- `public/pigeon-dashboard.css`: desktop- en mobiele weergave.
- `server.js`: serveert het nieuwe stylesheet via de bestaande assetlijst.
- `test/adoption.test.js`: HTTP-/databasecontrole van het dashboard.
- `test-support/preview-adoption.js`: geïsoleerde dashboardpreview.
- `README.md`, `docs/tamagotchi-model.md`, `docs/adoption-setup.md` en dit document:
  bijgewerkte status en instructies.
