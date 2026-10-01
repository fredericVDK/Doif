# Pigeon Clinic — fase 31

Een verloren battle kan Health kosten. De Pigeon Clinic op `/my-pigeon` maakt
die battlecyclus herstelbaar:

- een bezoek kost **100 Pigeon Coins**;
- Health wordt volledig hersteld tot 100;
- de blessure en battle-cooldown worden gewist, zodat je direct opnieuw kunt vechten;
- een duif met 100 Health wordt niet behandeld en betaalt niets;
- een tekort aan coins verandert Health en het saldo niet;
- een herhaald of gelijktijdig verzoek kan maar eenmaal betalen en herstellen.

Honderd coins is ongeveer driekwart van de circa 133 vaste coins die een actieve
speler per dag kan verdienen. Daardoor heeft battleschade betekenis, terwijl één
normale actieve dag doorgaans voldoende is om een behandeling te betalen.

De database berekent het actuele tijdsverloop vóór de behandeling en bewaart de
Health-update, coinbetaling en het ontvangstbewijs in één transactie. De browser
stuurt alleen een unieke request-ID en bepaalt geen prijs of herstelwaarde.

## Eenmalig activeren

Open Supabase → **SQL Editor** → **New query**, plak de volledige inhoud van
`migrations/024_pigeon_clinic.sql` en klik **Run**. Voer deze migratie eenmaal uit
nadat migratie 023 actief is.

Voer na migratie 030 ook `migrations/031_clinic_resets_battle_recovery.sql`
eenmaal uit. Die migratie laat de Arena direct verversen na een behandeling en
maakt de duif server-side meteen opnieuw battle-ready.
