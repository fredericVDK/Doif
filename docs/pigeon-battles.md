# Pigeon Battle — nieuwe fase 29

Op de beveiligde route `/battle` neemt de persoonlijke duif het op tegen één
van de andere starterrassen. Een gevecht kost 10 Energy. Een overwinning geeft
18 XP; een verlies geeft 8 XP. De normale centrale XP- en groeilogica verwerkt
level-ups onmiddellijk.

De browser kiest alleen de tegenstander en maakt een unieke request-ID. De
database berekent beide powerscores en de uitslag. Dezelfde request-ID kan maar
één keer Energy gebruiken en XP geven. Tussen gevechten geldt een server-side
cooldown van 30 seconden en een duif heeft minstens 10 actuele Energy nodig.

## Eenmalig activeren

1. Voer eerst `migrations/018_inventory_feeding.sql` uit.
2. Open Supabase → **SQL Editor** → **New query**.
3. Plak de volledige inhoud van `migrations/019_pigeon_battles.sql`.
4. Klik **Run** en herlaad daarna de website.

Migratie 019 bewaart bestaande accounts en voortgang. Ze voegt alleen het
laatste gevechtstijdstip en idempotente battle receipts toe.

## Controle

`npm test` test de echte SQL-functie met PGlite, inclusief XP, Energy,
cooldown, ongeldige tegenstanders, veilige retries, routebeveiliging en RLS.
