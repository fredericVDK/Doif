# Shop — fase 16

De beveiligde [Pigeon Shop](http://localhost:3037/shop) verkoopt de vier
voedselitems uit de inventaris. De pagina toont het actuele Pigeon Coins-saldo,
de serverprijs, effecten en het aantal dat de speler al bezit.

| Item | Prijs |
|---|---:|
| Crumbs | 10 coins |
| Corn | 25 coins |
| Peas | 35 coins |
| Sunflower Seeds | 50 coins |

Een klik koopt één item. Saldo en eigen hoeveelheid veranderen direct op de
pagina. Knoppen voor onbetaalbare items zijn uitgeschakeld en worden opnieuw
berekend na elke aankoop.

## Eenmalig activeren

1. Zorg dat migraties 001–013 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/014_shop.sql` en klik **Run**.
4. Herstart de server met Ctrl+C en daarna `npm start`.
5. Meld je aan en open [Shop](http://localhost:3037/shop).

Migratie 014 is lokaal getest en nog niet door de agent op Supabase uitgevoerd.
Ze vereist geen nieuwe sleutels en verandert bestaande accounts, duiven,
voortgang, saldi of inventarissen niet.

## Veilige aankopen

`buy_game_item` ontvangt uitsluitend de geverifieerde gebruiker, een item-ID en
een unieke request-ID. De database vergrendelt het profiel, leest de actuele
catalogusprijs, controleert het saldo, trekt coins af, verhoogt de inventaris en
schrijft een aankoopbewijs in één transactie.

`game_shop_purchase_receipts` maakt iedere request-ID per account uniek. Wanneer
een antwoord onderweg verloren gaat, kan de browser hetzelfde verzoek veilig
herhalen. Het item wordt niet opnieuw toegevoegd en de speler wordt niet opnieuw
betaald. Verschillende gelijktijdige verzoeken worden achter elkaar verwerkt,
waardoor het saldo nooit negatief wordt.

De browser kan prijs, aantal, coins of gebruiker meesturen, maar deze velden
worden genegeerd. RLS laat een speler alleen eigen aankoopbewijzen lezen. De
koopfunctie en alle tabelwrites zijn alleen beschikbaar voor de serverrol.

## Foutafhandeling

- Onvoldoende saldo geeft aan hoeveel coins nog ontbreken en verandert niets.
- Een verdwenen of ongeldig item wordt geweigerd.
- Bij een databasefout worden coin- en inventorywijzigingen samen teruggedraaid.
- Bij een onzekere netwerkfout bewaart de browser de request-ID voor een veilige retry.
- Een verlopen sessie of verkeerde origin wordt door de bestaande beveiligde route geweigerd.

## Verificatie

```powershell
npm run test:shop
npm run test:game
```

De tests controleren migratiebehoud, databaseprijzen, vervalste velden,
gelijktijdige en dubbele aankopen, onvoldoende saldo, rollback, quantity-overflow,
actueel replayresultaat, interactie met care rewards, HTML-escaping, route- en
originbeveiliging, RLS, serverrechten, opslagfouten en opnieuw inloggen.

## Bestanden in deze fase

- Nieuw: `migrations/014_shop.sql`, `lib/game/shop.js`, `public/shop.js`,
  `public/shop.css`, `test/shop.test.js` en dit document.
- Gewijzigd: `lib/game/adoption.js`, `lib/game/pages.js`, `lib/auth/routes.js`,
  `server.js`, `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `package.json`, `README.md` en inventory-/dashboarddocumentatie.

Gekochte items worden blijvend opgeslagen en kunnen sinds migratie 018 via Feed
worden gebruikt; gratis Crumbs blijven beschikbaar. Fase 17 voegt de
[consistente navigatie](navigation.md) toe. Fase 18
voegt [dagelijkse opdrachten](daily-quests.md) toe met coins en XP als beloning.
