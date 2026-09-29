# Inventaris — fase 15

Iedere speler heeft nu een eigen, server-side inventaris. De beveiligde pagina
[Inventory](http://localhost:3037/inventory) toont het volledige voedselcatalogus,
de hoeveelheid per item, effecten en toekomstige winkelprijs.

De eerste vier items zijn:

| Item | Prijs | Effecten |
|---|---:|---|
| Crumbs | 10 coins | +15 Hunger, +2 Happiness |
| Corn | 25 coins | +22 Hunger, +3 Happiness |
| Peas | 35 coins | +20 Hunger, +5 Happiness, +3 Energy |
| Sunflower Seeds | 50 coins | +18 Hunger, +8 Happiness, +2 Energy |

Prijzen en effecten worden in de database bewaard. De browser bepaalt deze
waarden niet. Fase 15 voegt geen items toe aan bestaande accounts. Sinds fase 16
kun je items veilig kopen in de [Shop](shop.md). Het verbruiken van inventory-food
volgt later; gratis Crumbs op het verzorgingsscherm blijven werken.

## Eenmalig activeren

1. Zorg dat migraties 001–012 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/013_inventory.sql` en klik **Run**.
4. Herstart de server met Ctrl+C en daarna `npm start`.
5. Meld je aan en open [Inventory](http://localhost:3037/inventory).

Migratie 013 is lokaal getest en nog niet door de agent op Supabase uitgevoerd.
Ze vereist geen nieuwe sleutels. Accounts, duiven, stats, coins, XP, levels,
groeifases, ontdekkingen en dagelijkse beloningen blijven ongewijzigd.

## Datamodel en beveiliging

`game_items` is de centrale catalogus. De tabel bewaart naam, type, beschrijving,
prijs, vier mogelijke stat-effecten en een lokale afbeelding. Databasechecks
begrenzen alle waarden en item-ID's.

`game_user_items` bewaart alleen items die een speler werkelijk bezit. De
combinatie `(user_id, item_id)` is uniek en `quantity` moet positief zijn. Het
verwijderen van een account verwijdert de eigen inventaris automatisch. Een item
dat nog in een inventaris zit kan niet uit de centrale catalogus verdwijnen.

RLS laat spelers uitsluitend hun eigen hoeveelheden lezen. De centrale
`get_game_inventory`-functie en alle schrijfacties zijn alleen beschikbaar voor
de serverrol. `GET /api/game/inventory` gebruikt altijd de geverifieerde sessie;
queryparameters met een ander account-ID worden genegeerd.

## Verificatie

```powershell
npm run test:inventory
npm run test:game
```

De tests controleren migratiebehoud, de vier catalogusitems, accountisolatie,
HTML-escaping, lege en gevulde inventarissen, sessie- en profielbeveiliging,
databaseconstraints, cascades, RLS, serverrechten, opslagfouten en opnieuw
inloggen. De pagina is daarnaast handmatig gecontroleerd op desktop en mobiel.

## Bestanden in deze fase

- Nieuw: `migrations/013_inventory.sql`, `lib/game/inventory.js`,
  `public/inventory.css`, vier SVG-itemafbeeldingen, `test/inventory.test.js`
  en dit document.
- Gewijzigd: `lib/game/adoption.js`, `lib/game/pages.js`, `lib/auth/routes.js`,
  `server.js`, `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `package.json`, `README.md` en dashboarddocumentatie.

Fase 16 voegt de [Shop](shop.md) met server-side aankopen, coincontrole en veilige
retries toe. De volgende grote fase is **17: consistente navigatie**.
