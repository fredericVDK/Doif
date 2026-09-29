# Game-architectuur — fase 22

De spelarchitectuur heeft vier duidelijke lagen. De browser stuurt alleen een
intentie, de HTTP-laag valideert de sessie en invoer, de game-service kiest de
juiste databaseactie en PostgreSQL/Supabase bewaart en berekent de spelstatus.

```text
Browser (FEED / PLAY / CLEAN / SLEEP / BUY / CLAIM)
                         │
                         ▼
lib/auth/routes.js — sessie, origin, HTTP en invoer
                         │
                         ▼
lib/game/index.js — samengestelde game-service
  ├─ adoption / engine / care actions
  ├─ XP, groei en rewards via databasefuncties
  ├─ discoveries / inventory / shop
  ├─ quests / achievements
  └─ Catch the Crumbs
                         │
                         ▼
Supabase RPC — tijd, locks, stats, XP, levels, coins en receipts
```

## Centrale modules

- `lib/game/index.js` is het enige compositiepunt. `createGameService(admin)`
  levert alle domeinfuncties aan de server.
- `lib/game/service-support.js` bevat UUID-validatie en consistente opslag- en
  cooldownfouten. Domeinmodules behouden hun eigen gebruikersmeldingen.
- `lib/game/presentation.js` vertaalt een opgeslagen pigeon-resultaat één keer
  naar de bestaande stat-, XP- en groeimarkup.
- `lib/game/engine.js` vraagt de centrale `refresh_game_pigeon`-functie aan.
- De overige bestanden in `lib/game` blijven kleine domeinservices; ze bevatten
  geen sessielogica en vertrouwen geen clientwaarden voor stats of rewards.

De oude naam `createGameRepository` blijft als compatibele alias beschikbaar.
Nieuwe code gebruikt `createGameService` via `lib/game/index.js`.

## Autoriteit en transacties

Spelregels blijven in de opeenvolgende SQL-migraties. De database berekent
verstreken tijd, effecten, XP, levels, groei, coins en rewards onder row locks en
schrijft idempotente receipts in dezelfde transactie. Browservelden zoals
`coins`, `xp`, `userId`, statwaarden en timestamps worden niet doorgestuurd.

Deze fase is een interne herstructurering. Er is geen nieuwe Supabase-migratie en
geen wijziging aan bestaande endpoints of opgeslagen data.
