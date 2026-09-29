# Consistente navigatie — fase 17

Alle publieke en accountgebonden pagina’s gebruiken nu dezelfde kernnavigatie,
in dezelfde volgorde:

1. Home
2. My Pigeon
3. PigeonDex
4. Shop
5. Inventory
6. Pigder
7. Drawings
8. API

De actieve pagina krijgt `aria-current="page"` en dezelfde visuele markering.
Ingelogde account- en gamepagina’s voegen **Sign out** toe. De beheerpagina houdt
een extra **Admin**-link; die technische bestemming staat niet in de primaire
navigatie van gewone bezoekers.

## Responsive gedrag

`public/site-navigation.css` bepaalt de gedeelde knopstijl, hover-, focus- en
actieve toestand. Op brede schermen mogen links ombreken wanneer dat nodig is.
Op schermen tot 760 pixels blijft de navigatie één horizontale, scrollbare rij.
Zo neemt ze weinig verticale ruimte in en blijven alle bestemmingen bereikbaar
met aanraking en toetsenbord.

Publieke HTML-pagina’s bevatten de links rechtstreeks, zodat navigatie ook zonder
JavaScript werkt. Dynamische auth-, adoption- en gamepagina’s gebruiken de
centrale serverhelper `lib/navigation.js`. Nieuwe dynamische pagina’s kunnen
daardoor niet ongemerkt een andere volgorde of oude benaming introduceren.

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

- Nieuw: `lib/navigation.js`, `public/site-navigation.css`,
  `test/navigation.test.js` en dit document.
- Gewijzigd: `public/index.html`, `public/pigeondex.html`, `public/pigder.html`,
  `public/drawings.html`, `public/api-docs.html`, `public/admin.html`,
  `lib/auth/pages.js`, `lib/game/pages.js`, `server.js`,
  `test-support/preview-adoption.js`, `package.json`, `README.md` en relevante
  fasehandleidingen.

De volgende grote fase is **18: dagelijkse opdrachten**.
