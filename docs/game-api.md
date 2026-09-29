# Game-API en backendacties — fase 23

`lib/game/api.js` is de centrale registratie voor alle accountgebonden
game-endpoints. Iedere registratie koppelt een HTTP-methode en pad aan een korte
beschrijving. Dezelfde lijst voedt methodecontrole in de auth-router en de
publieke `/api/docs`-pagina, zodat documentatie en uitvoering niet uiteenlopen.

## Kernacties

| Methode | Pad | Functie |
| --- | --- | --- |
| GET | `/api/game/starters` | Beschikbare starterduiven |
| GET | `/api/game/pigeon` | Actuele duif na server-side tijdsverloop |
| POST | `/api/game/adopt` | Starter kiezen en benoemen |
| POST | `/api/game/feed` | Crumbs voeren |
| POST | `/api/game/play` | Spelen |
| POST | `/api/game/clean` | Schoonmaken |
| POST | `/api/game/sleep` | Rusten |
| GET | `/api/game/inventory` | Eigen itemaantallen |
| POST | `/api/game/shop/buy` | Item kopen tegen databaseprijs |
| GET | `/api/game/pigeondex` | Persoonlijke ontdekkingen en voortgang |
| POST | `/api/game/daily-reward` | Dagelijkse beloning claimen |

Daarnaast registreert dezelfde module de bestaande quests, achievements,
discovery- en Catch the Crumbs-acties. `/api/game/discoveries` blijft bestaan als
compatibel pad voor de bestaande PigeonDex-client; nieuwe integraties kunnen het
duidelijkere `/api/game/pigeondex` gebruiken.

Alle gamepaden vereisen een geverifieerde Supabase-gebruiker en een profiel.
POST-acties vereisen dezelfde origin en JSON. De dispatcher haalt alleen
toegestane intentievelden uit de body. Identiteit, prijzen, effecten, tijd,
rewards, XP en coins komen uit de server/database. Mutaties met een request-ID
blijven veilig opnieuw uitvoerbaar.

Deze fase voegt geen tabellen of databasefuncties toe en vereist dus geen nieuwe
Supabase-migratie.
