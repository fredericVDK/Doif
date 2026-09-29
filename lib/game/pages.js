const { escapeHtml: e } = require("../auth/pages");
const { safeUrl } = require("../birdnet");
const {renderNavigation}=require('../navigation');

function imageUrl(value) {
  if (value === "assets/pigeon-hero-wide.png" || value === "/assets/pigeon-hero-wide.png") return "/assets/pigeon-hero-wide.png";
  const safe = safeUrl(value);
  if (safe && ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(new URL(safe).hostname)) return safe;
  return "/assets/pigeon-hero-wide.png";
}
function photo(species) {
  const credit = species.image_attribution || {};
  return `<figure class="pigeon-photo"><img src="${e(imageUrl(species.image))}" alt="${e(species.name)}" width="600" height="420" data-pigeon-photo>
    <figcaption>${credit.artist ? `${e(credit.artist)} · ` : ""}<a href="${e(safeUrl(credit.sourceUrl) || safeUrl(species.source_url))}" target="_blank" rel="noreferrer">Photo source</a>${credit.license && safeUrl(credit.licenseUrl) ? ` · <a href="${e(safeUrl(credit.licenseUrl))}" target="_blank" rel="noreferrer">${e(credit.license)}</a>` : ""}</figcaption></figure>`;
}
function shell(title, content, { dashboard = false, inventory = false, shop = false, game = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
    <title>${e(title)} · Pigeon Crumbs</title><link rel="stylesheet" href="/auth.css"><link rel="stylesheet" href="/adoption.css">
    <link rel="stylesheet" href="/site-navigation.css">
    ${dashboard ? '<link rel="stylesheet" href="/pigeon-dashboard.css"><link rel="stylesheet" href="/pigeon-discovery.css"><link rel="stylesheet" href="/pigeon-battle.css"><link rel="stylesheet" href="/pigeon-packs.css"><link rel="stylesheet" href="/pigeon-clinic.css"><script src="/pigeon-ui.js" defer></script><script src="/pigeon-discovery.js" defer></script><script src="/pigeon-care.js" defer></script><script src="/pigeon-daily-reward.js" defer></script><script src="/pigeon-daily-quests.js" defer></script><script src="/pigeon-achievements.js" defer></script><script src="/pigeon-feed.js" defer></script><script src="/pigeon-play.js" defer></script><script src="/pigeon-clean.js" defer></script><script src="/pigeon-sleep.js" defer></script><script src="/pigeon-battle.js" defer></script><script src="/pigeon-packs.js" defer></script><script src="/pigeon-clinic.js" defer></script>' : ""}
    ${inventory ? '<link rel="stylesheet" href="/inventory.css">' : ""}
    ${shop ? '<link rel="stylesheet" href="/inventory.css"><link rel="stylesheet" href="/shop.css"><script src="/shop.js" defer></script>' : ""}
    ${game ? '<link rel="stylesheet" href="/crumb-game.css"><script src="/crumb-game.js" defer></script>' : ""}
    <script src="/adoption.js" defer></script></head><body>
    <header class="account-header"><a class="brand" href="/">Pigeon Crumbs<span>A little kindness goes a long way.</span></a>
    ${renderNavigation(dashboard?'my-pigeon':shop?'shop':inventory?'inventory':undefined,{signedIn:true})}</header>
    <main class="adoption-shell">${content}</main><footer class="account-footer">Be kind to the birds we forgot.</footer></body></html>`;
}
function renderAdoptionPage(starters) {
  return shell("Meet your first pigeon", `
    <div class="adoption-heading"><p class="eyebrow">A little home. A lifelong friend.</p><h1>Every story starts<br>with a pigeon.</h1>
    <p class="intro">Three little characters, one place in your roost. Who will you bring home?</p></div>
    <ol class="adoption-steps" aria-label="Adoption progress"><li id="chooseStep" aria-current="step"><span>01</span> Choose your pigeon</li><li id="nameStep"><span>02</span> Give them a name</li></ol>
    <section id="choosePanel" aria-labelledby="chooseTitle"><h2 id="chooseTitle" class="sr-only" tabindex="-1">Choose your pigeon</h2>
      <div class="starter-grid">${starters.map(species => `<article class="starter-card" data-starter="${e(species.id)}">
        ${photo(species)}<div class="starter-copy"><span class="rarity">${e(species.rarity)} · starter</span><h2>${e(species.name)}</h2>
        <p class="taxonomy"><i>${e(species.scientific_name)}</i> · domestic breed</p><p class="breed-description">${e(species.description)}</p>
        <a class="source-link" href="${e(safeUrl(species.source_url))}" target="_blank" rel="noreferrer">About this breed ↗</a>
        <button type="button" class="primary-button choose-pigeon" data-id="${e(species.id)}" data-name="${e(species.name)}" aria-label="Choose ${e(species.name)}">Choose this pigeon <span aria-hidden="true">→</span></button></div></article>`).join("")}</div>
      <p class="adoption-note">One pigeon per account. All three start with the same care needs and level.</p>
    </section>
    <section id="namePanel" class="name-panel" hidden aria-labelledby="nameTitle">
      <div id="chosenCard" class="chosen-card"></div>
      <div class="name-copy"><button type="button" id="changePigeon" class="text-button">← Choose a different pigeon</button>
      <p class="eyebrow">Make it personal</p><h2 id="nameTitle">Name your pigeon.</h2><p class="intro">A small name for a big new friendship.</p>
      <form id="adoptionForm"><fieldset id="adoptionFields"><label for="nickname">Your pigeon’s name</label>
      <input id="nickname" name="nickname" required autocomplete="off" placeholder="Gilbert" aria-describedby="nicknameHelp">
      <small id="nicknameHelp">1–32 characters. Pick a name you’ll love calling them.</small>
      <p class="adoption-note">This will be your one pigeon. Ready to bring them home?</p>
      <button class="primary-button" id="adoptButton" type="submit">Adopt my pigeon <span aria-hidden="true">→</span></button></fieldset></form>
      <p id="adoptionStatus" role="status" aria-live="polite" hidden></p><a id="existingPigeon" href="/my-pigeon" hidden>Go to my pigeon →</a></div>
    </section><noscript><p>Enable JavaScript to choose and name your pigeon.</p></noscript>`);
}
const STATS = [
  { key: "health", label: "Health", icon: "♥", states: ["Needs care", "Okay", "Strong"] },
  { key: "hunger", label: "Hunger", icon: "🍞", states: ["Hungry", "Peckish", "Full"] },
  { key: "happiness", label: "Happiness", icon: "☺", states: ["Unhappy", "Quiet", "Cheerful"] },
  { key: "energy", label: "Energy", icon: "ϟ", states: ["Tired", "Slowing down", "Rested"] },
  { key: "cleanliness", label: "Cleanliness", icon: "✧", states: ["Needs a wash", "A little dusty", "Spotless"] }
];
function statCard(pigeon, stat) {
  const raw = pigeon[stat.key];
  const known = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw));
  const value = known ? Math.min(100, Math.max(0, Number(raw))) : 0;
  const band = value < 30 ? 0 : value < 70 ? 1 : 2;
  const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
  return `<div class="stat-card stat-${stat.key} ${known ? ["stat-low", "stat-mid", "stat-high"][band] : "stat-unknown"}">
    <div class="stat-heading"><label id="${stat.key}Label" for="${stat.key}Meter"><span aria-hidden="true">${stat.icon}</span> ${stat.label}</label><strong>${known ? `${percent}%` : "—"}</strong></div>
    <meter id="${stat.key}Meter" min="0" max="100" value="${value}" aria-labelledby="${stat.key}Label" aria-valuetext="${known ? `${percent} percent — ${stat.states[band]}` : "Unavailable"}">${known ? `${percent}%` : "Unavailable"}</meter>
    <span class="stat-description">${known ? stat.states[band] : "Unavailable"}</span></div>`;
}
function renderQuestCards(dailyQuests={quests:[]}) {
  return dailyQuests.quests.map(quest=>`<article class="quest-card${quest.claimed?' quest-claimed':quest.completed?' quest-complete':''}" data-quest-id="${e(quest.id)}">
    <div class="quest-copy"><span class="quest-check" aria-hidden="true">${quest.completed?'✓':'○'}</span><div><h3>${e(quest.title)}</h3>
    <p><strong data-quest-progress>${Number(quest.progress)} / ${Number(quest.goal)}</strong> · <span aria-label="Reward ${Number(quest.reward.coins)} coins and ${Number(quest.reward.xp)} XP">◉ ${Number(quest.reward.coins)} · ${Number(quest.reward.xp)} XP</span></p></div></div>
    <button type="button" class="quest-claim" data-quest-claim="${e(quest.id)}"${quest.completed&&!quest.claimed?'':' disabled'}>${quest.claimed?'Claimed':quest.completed?'Claim reward':'In progress'}</button>
  </article>`).join('');
}
const ACHIEVEMENT_ICONS={first_crumb:'🍞',pigeon_parent:'🏠',bird_nerd:'🔎',best_friends:'♥',collector:'🎒'};
function renderAchievementCards(data={achievements:[]}) {
  return data.achievements.map(item=>`<article class="achievement-card${item.claimed?' achievement-claimed':item.unlocked?' achievement-unlocked':''}" data-achievement-id="${e(item.id)}">
    <span class="achievement-icon" aria-hidden="true">${ACHIEVEMENT_ICONS[item.id]||'★'}</span><div class="achievement-copy"><h3>${e(item.title)}</h3><p>${e(item.description)}</p>
    <p class="achievement-progress"><strong>${Number(item.progress)} / ${Number(item.goal)}</strong> · ◉ ${Number(item.reward.coins)} · ${Number(item.reward.xp)} XP</p></div>
    <button type="button" class="achievement-claim" data-achievement-claim="${e(item.id)}"${item.unlocked&&!item.claimed?'':' disabled'}>${item.claimed?'Claimed':item.unlocked?'Claim reward':'Locked'}</button>
  </article>`).join('');
}
function pigeonStates(pigeon) {
  const states=[];
  if(Number(pigeon.happiness)>=70) states.push('happy');
  if(Number(pigeon.hunger)<30) states.push('hungry');
  if(Number(pigeon.cleanliness)<30) states.push('dirty');
  if(Number(pigeon.energy)<30) states.push('tired');
  return states.length?states:['calm'];
}
function pigeonMood(pigeon) {
  const labels={happy:'Happy',hungry:'Hungry',dirty:'Needs a wash',tired:'Tired',calm:'Content'};
  return pigeonStates(pigeon).map(state=>labels[state]).join(' · ');
}
function renderPigeonPage(pigeon, profile = {}, dailyQuests={quests:[]}, achievements={achievements:[],unlockedCount:0,total:5}, inventory={items:[]}) {
  const count = value => value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0
    ? new Intl.NumberFormat("en").format(Number(value)) : "—";
  const saved = new Date(pigeon.last_updated);
  const savedLabel = Number.isNaN(saved.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC"
  }).format(saved);
  const foodEffects=item=>[
    ['Hunger',item.hunger_effect],['Happiness',item.happiness_effect],
    ['Energy',item.energy_effect],['Cleanliness',item.cleanliness_effect]
  ].filter(([,value])=>Number(value)!==0).map(([label,value])=>`+${Number(value)} ${label}`).join(' · ');
  const ownedFood=(inventory.items||[]).filter(item=>item.type==='food'&&item.id!=='crumbs'&&Number(item.quantity)>0);
  const foodChoices=[`<label class="food-choice" data-food-choice="crumbs"><input type="radio" name="food" value="crumbs" checked required><span class="food-icon" aria-hidden="true">🍞</span><span><strong>Crumbs</strong><small>A few familiar favourites. Free.</small><small class="food-choice-effects">+15 Hunger · +2 Happiness</small></span></label>`]
    .concat(ownedFood.map(item=>`<label class="food-choice" data-food-choice="${e(item.id)}"><input type="radio" name="food" value="${e(item.id)}" required><img class="food-item-image" src="${e(item.image)}" alt=""><span><strong>${e(item.name)}</strong><small>Owned: <b data-food-quantity>${Number(item.quantity)}</b></small><small class="food-choice-effects">${e(foodEffects(item))}</small></span></label>`)).join('');
  return shell(`${pigeon.nickname}’s roost`, `<div class="pigeon-dashboard" data-pigeon-id="${e(pigeon.id)}" data-pigeon-version="${e(pigeon.version)}" data-pigeon-level="${e(pigeon.level)}" data-pigeon-stage="${e(pigeon.growth_stage)}" data-coins-version="${e(profile.coins_version ?? 0)}">
    <div class="roost-heading"><div><p class="eyebrow">A little home. A feathered friend.</p><p class="roost-greeting">Welcome to your roost${profile.username ? `, ${e(profile.username)}` : ""}.</p></div><a href="/pigeondex.html">Explore PigeonDex ↗</a></div>
    <section class="pigeon-hero" id="pigeonHero" data-pigeon-state="${e(pigeonStates(pigeon).join(' '))}" aria-labelledby="pigeonName"><div class="pigeon-scene">${photo(pigeon.species)}
      <div class="scene-effects" aria-hidden="true"><span>•</span><span>✦</span><span>z</span></div></div><div class="pigeon-identity">
      <span id="growthStage">${renderGrowth(pigeon)}</span><h1 id="pigeonName">${e(pigeon.nickname)}</h1>
      <p class="pigeon-breed">${e(pigeon.species.name)}</p><p class="taxonomy"><i>${e(pigeon.species.scientific_name)}</i> · ${pigeon.species.kind === "breed" ? "domestic breed" : "species"}</p>
      <p class="pigeon-mood" id="pigeonMood"><span class="mood-dot" aria-hidden="true"></span><span data-mood-label>${e(pigeonMood(pigeon))}</span></p>
      <p class="pigeon-caption">A small bird. A story of your own.</p>
      <dl class="pigeon-progress"><div><dt>Level</dt><dd id="levelValue">${count(pigeon.level)}</dd></div><div><dt>XP</dt><dd id="xpValue">${count(pigeon.xp)}</dd></div><div><dt><span aria-hidden="true">◉</span> Coins</dt><dd id="coinsValue" aria-label="Pigeon Coins">${count(profile.coins)}</dd></div></dl>
    <div id="xpProgress">${renderXpProgress(pigeon)}</div>
      <p id="levelFeedback" class="level-feedback" role="status" aria-live="polite" hidden></p>
    </div></section>
    <section class="pigeon-vitals" aria-labelledby="vitalsTitle"><div class="section-heading"><div><p class="eyebrow">The little things matter</p><h2 id="vitalsTitle">How your pigeon is doing</h2></div><a href="/my-pigeon" aria-label="Refresh your pigeon’s stats">Refresh stats ↻</a></div>
      <div class="stats-grid" id="pigeonStats">${renderStats(pigeon)}</div>
      <p id="feedFeedback" class="feed-feedback" role="status" aria-live="polite" hidden></p>
      <p class="stats-help">Higher bars mean your pigeon’s needs are better met. A full Hunger bar means a full tummy.</p>
      <p class="stats-help">Needs change while you’re away. Stats update when you open or refresh this page. Your pigeon will always be here when you return.</p>
    </section>
    <section class="roost-shortcuts" aria-label="Roost essentials">
      <a class="shortcut-card inventory-shortcut" href="/inventory"><span class="shortcut-icon" aria-hidden="true">🎒</span><span><small>Your supplies</small><strong>Inventory</strong><span>See food and treats you own.</span></span><b aria-hidden="true">→</b></a>
      <a class="shortcut-card shop-shortcut" href="/shop"><span class="shortcut-icon" aria-hidden="true">🌽</span><span><small>A little treat</small><strong>Shop</strong><span>Spend coins on pigeon favourites.</span></span><b aria-hidden="true">→</b></a>
    </section>
    <section class="pigeon-care" aria-labelledby="careTitle"><div class="section-heading"><div><p class="eyebrow">A little kindness goes a long way</p><h2 id="careTitle">Spend a moment together</h2></div></div>
      <p id="careAvailability">Offer a few crumbs, play together, freshen those feathers or settle down for a rest.</p>
      <div class="care-actions"><button class="care-action feed-open" id="feedOpen" type="button" aria-haspopup="dialog" aria-controls="foodDialog"><span class="care-icon" aria-hidden="true">🍞</span><span><strong>Feed</strong><small>A few favourite crumbs</small></span></button><button class="care-action play-open" id="playButton" type="button" aria-describedby="playHelp"><span class="care-icon" aria-hidden="true">☺</span><span><strong id="playLabel">Play</strong><small>A little fun together</small></span></button><button class="care-action clean-open" id="cleanButton" type="button" aria-describedby="cleanHelp"><span class="care-icon" aria-hidden="true">✧</span><span><strong id="cleanLabel">Clean</strong><small>Freshen those feathers</small></span></button><button class="care-action sleep-open" id="sleepButton" type="button" aria-describedby="sleepHelp"><span class="care-icon" aria-hidden="true">☾</span><span><strong id="sleepLabel">Sleep</strong><small>A cosy moment of rest</small></span></button></div>
      <p class="stats-help" id="playHelp">Play uses 10 Energy and gives up to +15 Happiness, +10 XP and +5 coins. Give your pigeon 10 seconds between games.</p>
      <p id="playFeedback" class="feed-feedback" role="status" aria-live="polite" hidden></p>
      <a id="playRecovery" href="/my-pigeon" hidden>Return to my pigeon →</a>
      <p class="stats-help" id="cleanHelp">Clean gives up to +30 Cleanliness and +5 Happiness, plus +5 XP and +2 coins. Give your pigeon 10 seconds between washes.</p>
      <p id="cleanFeedback" class="feed-feedback" role="status" aria-live="polite" hidden></p>
      <a id="cleanRecovery" href="/my-pigeon" hidden>Return to my pigeon →</a>
      <p class="stats-help" id="sleepHelp">A short rest restores up to +30 Energy and +5 Happiness right away. Wait 10 seconds between rests.</p>
      <p id="sleepFeedback" class="feed-feedback" role="status" aria-live="polite" hidden></p>
      <a id="sleepRecovery" href="/my-pigeon" hidden>Return to my pigeon →</a>
    </section>
    <aside class="minigame-invite"><div><p class="eyebrow">A quick game in the square</p><h2>Catch the Crumbs</h2><p>Move left and right, catch falling crumbs and earn a server-checked reward.</p></div><a class="primary-button" href="/catch-the-crumbs">Play for 30 seconds →</a></aside>
    <aside class="minigame-invite battle-invite" aria-labelledby="battleTitle"><div><p class="eyebrow">The friendly feather arena</p><h2 id="battleTitle">Pigeon Battle</h2><p>Press Battle for an automatic opponent. Higher levels are harder, but a win awards more XP. A loss awards no XP.</p></div><button class="primary-button" id="startBattle" type="button">Battle →</button><p id="battleResult" class="battle-result" role="status" aria-live="polite" hidden></p></aside>
    <aside class="minigame-invite clinic-invite" aria-labelledby="clinicTitle"><div><p class="eyebrow">Care after the arena</p><h2 id="clinicTitle">Pigeon Clinic</h2><p>A clinic visit restores ${e(pigeon.nickname)} to 100 Health. Full Health is never charged.</p></div><button class="primary-button" id="visitClinic" type="button">Visit clinic · ◉ 100</button><p id="clinicResult" class="clinic-result" role="status" aria-live="polite" hidden></p></aside>
    <section class="pigeon-packs" id="pigeonPacks" aria-labelledby="pigeonPacksTitle"><div class="section-heading"><div><p class="eyebrow">Grow your PigeonDex</p><h2 id="pigeonPacksTitle">Pigeon Packs</h2></div><a href="/pigeondex.html">View collection →</a></div>
      <p class="pack-intro">Open a pack for random photo-verified pigeons. Already discovered one? You receive 50 coins back for that duplicate.</p>
      <div class="pack-grid"><article class="pack-card pack-normal"><span class="pack-icon" aria-hidden="true">✉</span><div><span class="pack-limit">Once per day</span><h3>Normal Pack</h3><p>2 random pigeons</p><strong><span aria-hidden="true">◉</span> 300 coins</strong></div><button class="primary-button" type="button" data-pack-buy="normal">Open Normal Pack</button></article>
      <article class="pack-card pack-big"><span class="pack-icon" aria-hidden="true">▣</span><div><span class="pack-limit">Once per week</span><h3>Big Pack</h3><p>5 random pigeons</p><strong><span aria-hidden="true">◉</span> 900 coins</strong></div><button class="primary-button" type="button" data-pack-buy="big">Open Big Pack</button></article></div>
      <p id="packStatus" class="pack-status" role="status" aria-live="polite">Checking pack availability…</p><div id="packResults" class="pack-results" hidden></div>
    </section>
    <section class="daily-quests" id="dailyQuests" aria-labelledby="dailyQuestsTitle" data-reset-at="${e(dailyQuests.resetAt||'')}"><div class="section-heading"><div><p class="eyebrow">A fresh list every day</p><h2 id="dailyQuestsTitle">Daily quests</h2></div><span class="quest-reset">Resets at 00:00 UTC</span></div>
      <p class="quest-intro">Small moments together earn a few extra coins and XP.</p>
      <div class="quest-list" id="dailyQuestList">${renderQuestCards(dailyQuests)}</div>
      <p id="dailyQuestStatus" class="quest-status" role="status" aria-live="polite" hidden></p>
    </section>
    <section class="achievements" id="achievements" aria-labelledby="achievementsTitle"><div class="section-heading"><div><p class="eyebrow">Milestones from your life together</p><h2 id="achievementsTitle">Achievements</h2></div><strong id="achievementSummary">${Number(achievements.unlockedCount)} / ${Number(achievements.total)} unlocked</strong></div>
      <div class="achievement-list" id="achievementList">${renderAchievementCards(achievements)}</div>
      <p id="achievementStatus" class="quest-status" role="status" aria-live="polite" hidden></p>
    </section>
    <dialog id="foodDialog" class="food-dialog" aria-labelledby="foodTitle" aria-describedby="foodHelp">
      <button type="button" id="closeFood" class="food-close" aria-label="Close food selector">×</button>
      <p class="eyebrow">A little treat</p><h2 id="foodTitle">What’s on the menu?</h2>
      <p id="foodHelp">Choose something for ${e(pigeon.nickname)}. A small kindness, a happier pigeon.</p>
      <form id="feedForm"><fieldset id="foodFields"><legend class="sr-only">Choose food</legend><div class="food-choice-list">${foodChoices}</div>
        <p class="food-effects">Every meal also gives +5 XP and +2 coins.</p>
        <small>Stats stop at 100. Give your pigeon 10 seconds between meals.</small>
        <button type="submit" class="primary-button" id="giveCrumbs">Give Crumbs <span aria-hidden="true">→</span></button>
      </fieldset></form><p id="foodStatus" role="status" aria-live="polite" hidden></p>
      <a id="feedRecovery" href="/my-pigeon" hidden>Return to my pigeon →</a>
    </dialog><noscript><p>Enable JavaScript to care for your pigeon.</p></noscript>
    <p class="saved-status" id="savedStatus">${savedLabel ? `Last saved <time datetime="${e(saved.toISOString())}">${e(savedLabel)} UTC</time>. ` : ""}Your pigeon’s progress is saved to your account.</p>
  </div>`, { dashboard: true });
}

function renderInventoryPage(inventory,profile={}) {
  const number=value=>Number(value).toLocaleString('en');
  const effects=item=>[
    ['Hunger',item.hunger_effect],['Happiness',item.happiness_effect],
    ['Energy',item.energy_effect],['Cleanliness',item.cleanliness_effect]
  ].filter(([,value])=>Number(value)!==0).map(([label,value])=>`${Number(value)>0?'+':''}${number(value)} ${label}`).join(' · ');
  const cards=inventory.items.map(item=>`<article class="inventory-card${item.quantity>0?' inventory-owned':''}">
    <img src="${e(item.image)}" alt="" width="160" height="120"><div class="inventory-card-copy">
    <div class="inventory-card-heading"><div><span class="inventory-type">${e(item.type)}</span><h2>${e(item.name)}</h2></div><strong class="inventory-quantity" aria-label="Quantity ${number(item.quantity)}">×${number(item.quantity)}</strong></div>
    <p>${e(item.description)}</p><p class="inventory-effects">${e(effects(item))}</p>
    <div class="inventory-card-footer"><p class="inventory-price"><span aria-hidden="true">◉</span> ${number(item.price)} coins</p>${item.quantity>0&&item.type==='food'&&item.id!=='crumbs'?`<a class="primary-button inventory-use" href="/my-pigeon?food=${encodeURIComponent(item.id)}">Give to pigeon</a>`:''}</div></div></article>`).join('');
  return shell('Your inventory',`<div class="inventory-page">
    <header class="inventory-heading"><div><p class="eyebrow">A pocket full of kindness</p><h1>Your inventory</h1><p>Food and useful little things for your pigeon, ${profile.username?e(profile.username):'pigeon friend'}.</p></div>
    <a href="/my-pigeon">Back to my pigeon →</a></header>
    <section class="inventory-summary" aria-label="Inventory summary"><div><span>Different items</span><strong>${number(inventory.summary.distinctOwned)}</strong></div><div><span>Total items</span><strong>${number(inventory.summary.totalQuantity)}</strong></div></section>
    ${inventory.summary.totalQuantity===0?'<p class="inventory-empty" role="status"><strong>Your pockets are empty for now.</strong> Visit the <a href="/shop">Pigeon Shop</a> to pick a treat. Free Crumbs on the care screen remain available.</p>':''}
    <section aria-labelledby="foodInventoryTitle"><div class="inventory-section-heading"><div><p class="eyebrow">Food collection</p><h2 id="foodInventoryTitle">Pigeon favourites</h2></div><span>${inventory.items.length} items</span></div>
    <div class="inventory-grid">${cards}</div></section>
    <p class="inventory-note">Prices, effects and quantities are checked by the server. Buy more in the <a href="/shop">Pigeon Shop</a>, or give an owned treat directly to your pigeon.</p>
  </div>`,{inventory:true});
}

function renderShopPage(inventory,profile={}) {
  const number=value=>Number(value).toLocaleString('en');
  const balance=Number(profile.coins)||0;
  const effects=item=>[
    ['Hunger',item.hunger_effect],['Happiness',item.happiness_effect],
    ['Energy',item.energy_effect],['Cleanliness',item.cleanliness_effect]
  ].filter(([,value])=>Number(value)!==0).map(([label,value])=>`${Number(value)>0?'+':''}${number(value)} ${label}`).join(' · ');
  const cards=inventory.items.map(item=>`<article class="shop-card" data-shop-item="${e(item.id)}" data-price="${e(item.price)}">
    <img src="${e(item.image)}" alt="" width="160" height="120"><div class="shop-card-copy"><span class="inventory-type">${e(item.type)}</span><h2>${e(item.name)}</h2>
    <p>${e(item.description)}</p><p class="inventory-effects">${e(effects(item))}</p>
    <div class="shop-card-footer"><div><strong><span aria-hidden="true">◉</span> ${number(item.price)}</strong><small>Owned: <span data-owned>${number(item.quantity)}</span></small></div>
    <button type="button" class="primary-button shop-buy" data-item-id="${e(item.id)}" ${balance<Number(item.price)?'disabled aria-describedby="shopBalanceHelp"':''}>Buy ${e(item.name)}</button></div></div></article>`).join('');
  return shell('Pigeon Shop',`<div class="shop-page" data-shop-balance="${e(balance)}" data-coins-version="${e(profile.coins_version??0)}">
    <header class="shop-heading"><div><p class="eyebrow">A little market for little friends</p><h1>Pigeon Shop</h1><p>Pick a treat for your inventory. Every price and purchase is checked by the server.</p></div>
    <div class="shop-wallet"><span>Your balance</span><strong><span aria-hidden="true">◉</span> <span id="shopCoins">${number(balance)}</span></strong><small>Pigeon Coins</small></div></header>
    <p id="shopBalanceHelp" class="shop-help">Care for your pigeon and return each day to earn more coins.</p>
    <p id="shopStatus" class="shop-status" role="status" aria-live="polite" hidden></p>
    <section aria-labelledby="shopFoodTitle"><div class="inventory-section-heading"><div><p class="eyebrow">Food shelf</p><h2 id="shopFoodTitle">Choose a favourite</h2></div><a href="/inventory">View inventory →</a></div>
    <div class="shop-grid">${cards}</div></section>
    <p class="inventory-note">One click buys one item. A retried network request is charged only once.</p>
  </div>`,{shop:true});
}

function renderMinigamePage(pigeon,profile={}) {
  const number=value=>Number(value).toLocaleString('en');
  return shell('Catch the Crumbs',`<div class="crumb-game-page" data-pigeon-id="${e(pigeon.id)}">
    <header class="crumb-game-heading"><div><p class="eyebrow">A quick game in the square</p><h1>Catch the Crumbs</h1><p>Guide ${e(pigeon.nickname)} beneath the falling crumbs. Each valid catch raises your score.</p></div>
    <div class="crumb-game-wallet"><span>Your balance</span><strong><span aria-hidden="true">◉</span> <span id="gameCoins">${number(profile.coins)}</span></strong><small>Level ${number(pigeon.level)} · <span id="gameXp">${number(pigeon.xp)}</span> XP</small></div></header>
    <section class="crumb-game-card" aria-labelledby="gameInstructions"><div class="crumb-game-stats" aria-live="polite"><div><span>Time</span><strong id="gameTime">30</strong></div><div><span>Score</span><strong id="gameScore">0</strong></div></div>
      <div id="crumbBoard" class="crumb-board" aria-label="Catch the Crumbs game area"><div class="game-cloud cloud-one" aria-hidden="true"></div><div class="game-cloud cloud-two" aria-hidden="true"></div><canvas id="crumbCanvas" aria-label="${e(pigeon.nickname)} catching falling crumbs">Your browser needs canvas support to play.</canvas>
        <div id="gameOverlay" class="game-overlay"><p id="gameInstructions">Catch as many crumbs as you can in 30 seconds.</p><button type="button" id="startCrumbGame" class="primary-button">Start game</button></div></div>
      <div class="game-controls" aria-label="Pigeon controls"><button type="button" id="moveLeft" aria-label="Move pigeon left">←</button><p>Arrow keys, A/D, or these buttons</p><button type="button" id="moveRight" aria-label="Move pigeon right">→</button></div>
      <p id="gameStatus" class="game-status" role="status" aria-live="polite">Ready when you are.</p>
    </section><p class="game-note">Your reward is calculated by the server from the round’s timing and valid catches. A browser score cannot choose its own coins or XP.</p>
    <a class="back-to-roost" href="/my-pigeon">← Back to my pigeon</a>
  </div>`,{game:true});
}


function renderStats(pigeon) { return STATS.map(stat => statCard(pigeon, stat)).join(""); }
function renderXpProgress(pigeon) {
  const xp = Number(pigeon.xp), target = Number(pigeon.xp_to_next_level), level = Number(pigeon.level);
  if (!Number.isInteger(xp) || xp < 0 || !Number.isInteger(target) || target <= 0 || !Number.isInteger(level) || level < 1) {
    return '<p class="stats-help">Level progress is unavailable until the XP update is installed.</p>';
  }
  const number = value => value.toLocaleString("en");
  return `<div class="xp-progress"><label for="xpMeter">${number(xp)} / ${number(target)} XP toward Level ${number(level + 1)}</label>
    <progress id="xpMeter" max="${target}" value="${Math.min(xp,target)}" aria-label="Progress to Level ${number(level + 1)}">${number(xp)} / ${number(target)}</progress></div>`;
}
const GROWTH_LABELS = {hatchling:"Hatchling",juvenile:"Juvenile",adult:"Adult",best_friend:"Best Friend"};
function growthLabel(pigeon) { return GROWTH_LABELS[pigeon.growth_stage] || "Your pigeon"; }
function renderGrowth(pigeon) {
  const stage = Object.hasOwn(GROWTH_LABELS,pigeon.growth_stage) ? pigeon.growth_stage : "unknown";
  return `<span class="growth-badge" data-stage="${stage}">${e(growthLabel(pigeon))}</span>`;
}
module.exports = { renderAdoptionPage, renderPigeonPage, renderInventoryPage, renderShopPage, renderMinigamePage, renderStats, renderXpProgress, growthLabel, renderGrowth, renderQuestCards, renderAchievementCards };
