const {escapeHtml:e}=require('./pages');
const {safeUrl}=require('../birdnet');
const {renderNavigation}=require('../navigation');

function renderPlayerProfile(data,{owner=false,signedIn=false}={}){
  const title=data.username||'Player';
  const profilePath=`/player/${encodeURIComponent(title)}`;
  const pigeon=data.pigeon;
  const image=pigeon?(safeUrl(pigeon.image)||'/assets/pigeon-hero-wide.png'):'';
  const body=data.private&&!owner?`<section class="profile-private"><span aria-hidden="true">🔒</span><h1>${e(title)}</h1><p>This player keeps their Pigeon Crumbs profile private.</p></section>`:`<div class="player-profile-page" data-profile-public="${String(data.public!==false)}">
    <header class="player-profile-hero"><div><p class="eyebrow">Pigeon keeper profile</p><h1>${e(title)}</h1><p>Member since ${e(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric'}).format(new Date(data.joinedAt)))}</p><span class="battle-rank">${e(data.battle?.rank||'Rookie')} rank</span></div>${pigeon?`<figure><img src="${e(image)}" alt="${e(pigeon.breed)}"><figcaption>${e(pigeon.nickname)} · Level ${Number(pigeon.level)} ${e(pigeon.breed)}</figcaption></figure>`:'<div class="profile-no-pigeon">No pigeon adopted yet</div>'}</header>
    <section class="profile-stat-grid" aria-label="Player progress"><article><span>Pigeon level</span><strong>${Number(pigeon?.level||0)}</strong></article><article><span>Discoveries</span><strong>${Number(data.discoveries||0)}</strong></article><article><span>Achievements</span><strong>${Number(data.achievements||0)}</strong></article><article><span>Best streak</span><strong>${Number(data.streak||0)} days</strong></article><article><span>Battle wins</span><strong>${Number(data.battle?.wins||0)}</strong></article><article><span>Battle losses</span><strong>${Number(data.battle?.losses||0)}</strong></article></section>
    ${owner?`<section class="profile-settings"><div><p class="eyebrow">Profile visibility</p><h2>Who can see this page?</h2><p>Private profiles are visible only while you are signed in to this account.</p></div><label class="visibility-switch"><input id="profilePublic" type="checkbox" ${data.public!==false?'checked':''}><span>Public profile</span></label><p id="profileStatus" role="status" aria-live="polite"></p><a href="${e(profilePath)}">Open shareable profile →</a></section>`:''}
  </div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)} · Pigeon Crumbs</title><link rel="stylesheet" href="/auth.css"><link rel="stylesheet" href="/site-navigation.css"><link rel="stylesheet" href="/player-profile.css">${owner?'<script src="/player-profile.js" defer></script>':''}</head><body><header class="account-header"><a class="brand" href="/">Pigeon Crumbs<span>A little kindness goes a long way.</span></a>${renderNavigation(undefined,{signedIn})}</header><main>${body}</main><footer class="account-footer">Be kind to the birds we forgot.</footer></body></html>`;
}
module.exports={renderPlayerProfile};
