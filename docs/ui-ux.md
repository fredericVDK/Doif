# UI/UX — fase 21

Fase 21 maakt het Tamagotchi-gedeelte speelser en gezelliger zonder de bestaande
Pigeon Crumbs-stijl te vervangen. Het dashboard zet de persoonlijke duif in een
centrale roost-scene en gebruikt dezelfde rustige kleuren, randen en typografie
als de rest van de site.

## Duidelijke toestanden

De opgeslagen statistieken bepalen rechtstreeks welke labels zichtbaar zijn:

- **Happy** vanaf 70 Happiness.
- **Hungry** onder 30 Hunger.
- **Needs a wash** onder 30 Cleanliness.
- **Tired** onder 30 Energy.
- **Content** wanneer geen van deze bijzondere toestanden geldt.
- **Sleeping** verschijnt kort na een bevestigde Sleep-actie.

Meerdere toestanden kunnen tegelijk zichtbaar zijn. De browser verzint hierbij
geen spelwaarden; `PigeonCare` werkt de presentatie alleen bij met het door de
server opgeslagen resultaat.

## Feedback en beweging

Na een bevestigde actie toont de centrale scene een korte animatie: vallende
kruimels bij Feed, een sprongetje bij Play, een glans bij Clean en een rustige
`z` bij Sleep. Een level-up krijgt een korte gloed en het ontdekkingsvenster komt
subtiel in beeld. `prefers-reduced-motion` schakelt deze beweging vrijwel uit.

Stats, verzorgingsacties, quests en achievements blijven kaartgroepen. Twee
compacte kaarten op het dashboard geven directe toegang tot Inventory en Shop.
Op schermen tot 620 pixels worden de scene en kaarten onder elkaar geplaatst.

Deze fase wijzigt alleen templates, CSS en browserpresentatie. Er is geen nieuwe
Supabase-migratie nodig en alle beloningen en spelregels blijven server-side.
