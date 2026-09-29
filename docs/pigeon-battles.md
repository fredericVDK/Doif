# Pigeon Battle — nieuwe fase 29

Op `/my-pigeon` start **Battle** meteen een gevecht tegen een automatisch gekozen
starterras. Een gevecht kost 10 Energy. Verlies geeft geen XP. Bij winst is de
beloning `15 + (level × 3)` XP, zodat een moeilijker gevecht op een hoger level
ook duidelijk meer oplevert. De centrale XP- en groeilogica verwerkt level-ups.
Bij verlies verliest de duif maximaal 5 Health; Health zakt nooit onder 0. Een
overwinning kost geen Health.

De browser maakt alleen een unieke request-ID. De database kiest de tegenstander,
berekent de stijgende moeilijkheid en bepaalt de uitslag. Dezelfde request-ID kan maar
één keer Energy gebruiken en XP geven. Tussen gevechten geldt een server-side
cooldown van 30 seconden en een duif heeft minstens 10 actuele Energy nodig.

## Eenmalig activeren

1. Voer eerst `migrations/018_inventory_feeding.sql` uit.
2. Open Supabase → **SQL Editor** → **New query**.
3. Plak de volledige inhoud van `migrations/019_pigeon_battles.sql`.
4. Klik **Run** en herlaad daarna de website.

Heb je de eerste versie van migratie 019 al uitgevoerd en krijg je de melding
`last_battled_at already exists`? Voer 019 dan niet opnieuw uit. Gebruik alleen
`migrations/020_automatic_battles.sql`; die vervangt de functie zonder tabellen,
kolommen, eerdere battles of voortgang opnieuw aan te maken.

Voer daarna `migrations/021_battle_health.sql` één keer uit om het Health-verlies
bij een verloren gevecht te activeren.

Migratie 019 bewaart bestaande accounts en voortgang. Ze voegt alleen het
laatste gevechtstijdstip en idempotente battle receipts toe.

## Controle

`npm test` test de echte SQL-functie met PGlite, inclusief XP, Energy,
cooldown, ongeldige tegenstanders, veilige retries, routebeveiliging en RLS.
