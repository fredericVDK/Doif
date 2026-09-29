# Pigeon Packs — fase 30

In de `/shop` kunnen ingelogde spelers naast voedsel ook twee soorten packs openen:

| Pack | Inhoud | Prijs | Limiet |
| --- | ---: | ---: | --- |
| Normal Pack | 2 willekeurige duiven | 300 coins | eenmaal per UTC-dag |
| Big Pack | 5 willekeurige duiven | 900 coins | eenmaal per UTC-week |

De wekelijkse periode begint maandag om 00:00 UTC. Iedere duif komt uit de
foto-gecontroleerde PigeonDex-catalogus. Een pack bevat geen dubbele IDs binnen
dezelfde opening, maar kan wel een duif bevatten die de speler al eerder vond.
Voor iedere dergelijke duplicate krijgt de speler 50 coins terug.

De prijzen zijn gebaseerd op ongeveer 133 normale coins per actieve dag: 50 uit
de dagelijkse loginbeloning, 65 uit alle dagelijkse quests en 18 uit de
verzorgingsacties die daarvoor nodig zijn. Minigames en eenmalige achievements
kunnen extra coins opleveren. Een Normal Pack kost daardoor ruim twee actieve
dagen aan vaste inkomsten; een Big Pack bijna een actieve week.

De browser kiest geen duiven, prijs, periode of refund. De server kiest unieke
catalogusrecords en de database voert de coinbetaling, discoveries, duplicate
refunds, periodebeperking en receipt in één transactie uit. Een herhaalde
request-ID retourneert dezelfde opening zonder opnieuw coins af te trekken.

## Eenmalig activeren

Open Supabase → **SQL Editor** → **New query**, plak de volledige inhoud van
`migrations/023_pigeon_packs.sql` en klik **Run**. Voer de migratie eenmaal uit
nadat migratie 022 actief is.
