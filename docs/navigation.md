# Consistente navigatie — fase 17

Alle pagina’s gebruiken dezelfde gecentreerde knopnavigatie. Uitgelogde bezoekers
zien alleen de publieke bestemmingen, in deze volgorde:

1. Home
2. PigeonDex
3. Pigder
4. Drawings
5. API
6. Login

Na een geverifieerde accountsessie verschijnen de Tamagotchi-bestemmingen en
wordt Login vervangen door Sign out. De volledige volgorde is dan:

1. Home
2. My Pigeon
3. PigeonDex
4. Shop
5. Inventory
6. Pigder
7. Drawings
8. API

De actieve pagina krijgt `aria-current="page"` en dezelfde visuele markering.
De technische beheerpagina staat niet in de primaire navigatie.

## Responsive gedrag

`public/site-navigation.css` bepaalt de gedeelde knopstijl, hover-, focus- en
actieve toestand. Op brede schermen staan de knoppen gecentreerd bovenaan en
mogen ze ombreken wanneer dat nodig is.
Op schermen tot 760 pixels blijft de navigatie één horizontale, scrollbare rij.
Zo neemt ze weinig verticale ruimte in en blijven alle bestemmingen bereikbaar
met aanraking en toetsenbord.

Publieke HTML-pagina’s bevatten de publieke links en Login rechtstreeks, zodat
navigatie ook zonder JavaScript werkt. `public/site-navigation.js` vraagt alleen
de geverifieerde sessiestatus op en voegt de Tamagotchi-links toe wanneer er een
gebruiker is. Dynamische auth-, adoption- en gamepagina’s gebruiken de centrale
serverhelper `lib/navigation.js`.

## Activeren

Deze fase heeft **geen Supabase-migratie** en geen nieuwe environmentvariabelen.
Herstart alleen de Node-server met Ctrl+C en daarna:

```powershell
npm start
```

Controleer daarna bijvoorbeeld Home, PigeonDex, My Pigeon, Shop en Inventory.

## Verificatie

```powershell
npm run test:navigation
npm run test:game
```

De tests controleren de centrale volgorde en labels, alle zes statische pagina’s,
actieve-paginamarkering, accountacties, bestaande bestanden en applicatieroutes,
het gedeelde stylesheet en het mobiele horizontale gedrag.

## Bestanden in deze fase

- Nieuw: `lib/navigation.js`, `public/site-navigation.css`, `public/site-navigation.js`,
  `test/navigation.test.js` en dit document.
- Gewijzigd: `public/index.html`, `public/pigeondex.html`, `public/pigder.html`,
  `public/drawings.html`, `public/api-docs.html`, `public/leaderboard-admin.html`,
  `lib/auth/pages.js`, `lib/game/pages.js`, `server.js`,
  `test-support/preview-adoption.js`, `package.json`, `README.md` en relevante
  fasehandleidingen.

De volgende grote fase is **18: dagelijkse opdrachten**.
