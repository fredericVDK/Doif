# Dagelijkse beloning — fase 14

Bij het eerste bezoek aan **Mijn duif** op een UTC-kalenderdag ontvangt de
ingelogde speler automatisch:

- **+50 Pigeon Coins**
- **+20 XP**

De server bepaalt de gebruiker, datum en bedragen. De browser kan geen ander
account, toekomstige datum of hoger bedrag kiezen. Na een geslaagde claim toont
het dashboard een toegankelijk **Daily Reward**-venster. Een tweede bezoek op
dezelfde dag werkt het dashboard bij maar toont geen beloningsvenster en betaalt
niets opnieuw uit. De volgende beloning is beschikbaar na **00:00 UTC**.

## Eenmalig activeren

1. Zorg dat migraties 001–011 zijn uitgevoerd. Herhaal geen geslaagde migraties.
2. Open je bestaande Supabase-project → **SQL Editor** → nieuwe query.
3. Plak de volledige inhoud van `migrations/012_daily_reward.sql` en klik **Run**.
4. Herstart de server met Ctrl+C en daarna `npm start`.
5. Open [Mijn duif](http://localhost:3037/my-pigeon).

Migratie 012 is lokaal getest en nog niet door de agent op Supabase uitgevoerd.
Ze heeft geen nieuwe sleutels nodig en bewaart bestaande accounts, duiven,
stats, coins, XP, levels, groeifases en PigeonDex-ontdekkingen. Ze maakt geen
beloningen met terugwerkende kracht.

## Opslag en gelijktijdigheid

`game_daily_rewards` bewaart per account en UTC-datum één ontvangstbewijs. De
primaire sleutel `(user_id, reward_date)` maakt een tweede ontvangstbewijs
onmogelijk. De databasefunctie vergrendelt de duif voordat ze controleert en
uitbetaalt. Gelijktijdige tabs, dubbelklikken en netwerkherhalingen leveren
daarom samen maar één beloning op.

Coins, XP, level, groeifase en hun versies worden in dezelfde transactie
bijgewerkt als het ontvangstbewijs. Een databasefout draait alles terug.
Verzorgingsstats, cooldowns en `last_updated` veranderen niet door inloggen.
De bestaande XP-regels dragen overtollige XP over naar een volgend level.

RLS laat een speler alleen de eigen ontvangstbewijzen lezen. Claims en directe
schrijfacties zijn alleen beschikbaar voor de serverrol. Het publieke endpoint
accepteert uitsluitend een lege POST; alle doorgestuurde beloningsvelden worden
genegeerd.

## Verificatie

Gerichte tests:

```powershell
npm run test:daily
```

Volledige gametest:

```powershell
npm run test:game
```

De tests controleren behoud van bestaande data, exacte bedragen, UTC-grenzen,
gelijktijdige en herhaalde claims, level- en groeiovergangen, vervalste velden,
gelijktijdige verzorging, transactierollback, overflow, routebeveiliging,
serverrechten en opnieuw inloggen.

## Bestanden in deze fase

- Nieuw: `migrations/012_daily_reward.sql`, `lib/game/daily-reward.js`,
  `public/pigeon-daily-reward.js`, `test/daily-reward.test.js` en dit document.
- Gewijzigd: `lib/game/adoption.js`, `lib/auth/routes.js`, `lib/game/pages.js`,
  `public/pigeon-dashboard.css`, `public/pigeon-discovery.js`, `server.js`,
  `test-support/auth-fixture.js`, `test-support/preview-adoption.js`,
  `package.json` en `README.md`.

Fase 15 voegt de [inventaris](inventory.md) met vier voedselitems toe. De volgende
grote fase is **16: Shop**.
