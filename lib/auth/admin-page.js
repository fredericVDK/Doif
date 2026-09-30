const {escapeHtml:e}=require('./pages');
const {renderNavigation}=require('../navigation');

function accountCard(account){
  const created=new Date(account.createdAt);
  const joined=Number.isNaN(created.getTime())?'Unknown':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(created);
  const pigeon=account.pigeon;
  return `<article class="account-admin-card" data-account="${e(account.username)}">
    <div class="account-admin-identity"><span class="account-avatar" aria-hidden="true">${e(account.username.slice(0,1).toUpperCase())}</span><div><h2>${e(account.username)}</h2><p>Joined ${e(joined)}${account.isAdmin?' · Administrator':''}</p></div></div>
    <dl><div><dt>Coins</dt><dd><span aria-hidden="true">◉</span> <span data-account-coins>${Number(account.coins).toLocaleString('en')}</span></dd></div><div><dt>Discoveries</dt><dd>${Number(account.discoveries).toLocaleString('en')}</dd></div><div><dt>Pigeon</dt><dd>${pigeon?`${e(pigeon.nickname)} · Level ${Number(pigeon.level)}`:'Not adopted yet'}</dd></div><div><dt>Breed</dt><dd>${pigeon?e(pigeon.breed):'—'}</dd></div></dl>
    <form class="coin-grant-form" data-coin-form><label>Give coins to ${e(account.username)}<span><input name="amount" type="number" inputmode="numeric" min="1" max="100000" step="1" value="100" required><button type="submit">Add coins</button></span></label></form>
    ${account.isAdmin?'<p class="admin-protected-account">The active administrator account is protected.</p>':`<button class="delete-account-button" type="button" data-delete-account>Delete account</button>`}
  </article>`;
}

function renderAdminPage(profile,data={accounts:[],count:0},economy={}){
  const accounts=Array.isArray(data.accounts)?data.accounts:[];
  const number=value=>Number(value||0).toLocaleString('en');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Account Admin · Pigeon Crumbs</title><link rel="stylesheet" href="/auth.css"><link rel="stylesheet" href="/site-navigation.css"><link rel="stylesheet" href="/account-admin.css"><script src="/account-admin.js" defer></script></head><body>
    <header class="account-header"><a class="brand" href="/">Pigeon Crumbs<span>A little kindness goes a long way.</span></a>${renderNavigation('admin',{signedIn:true,admin:true})}</header>
    <main class="account-admin-page"><header class="account-admin-heading"><div><p class="eyebrow">Protected account tools</p><h1>Account Admin</h1><p>Welcome, ${e(profile.username)}. Review player progress and grant Pigeon Coins.</p></div><div class="account-total"><strong>${Number(data.count)||accounts.length}</strong><span>accounts</span></div></header>
      <p id="adminAccountStatus" class="admin-account-status" role="status" aria-live="polite">Coin grants are saved immediately and recorded in the admin audit log.</p>
      <section class="economy-panel" aria-labelledby="economyTitle"><div class="account-list-heading"><div><p class="eyebrow">Server-owned economy</p><h2 id="economyTitle">Economy overview</h2></div><span>Live totals</span></div><div class="economy-grid"><article><span>Coins in circulation</span><strong>◉ ${number(economy.totalCoins)}</strong></article><article><span>Average balance</span><strong>◉ ${number(economy.averageCoins)}</strong></article><article><span>Highest balance</span><strong>◉ ${number(economy.highestBalance)}</strong></article><article><span>Admin grants</span><strong>◉ ${number(economy.minted?.adminGrants)}</strong></article></div><div class="economy-flow"><p><strong>Coins created</strong><span>Daily ${number(economy.minted?.daily)} · Games ${number(economy.minted?.minigames)} · Battles ${number(economy.minted?.battles)}</span></p><p><strong>Coins spent</strong><span>Shop ${number(economy.spent?.shop)} · Packs ${number(economy.spent?.packs)} · Clinic ${number(economy.spent?.clinic)}</span></p></div></section>
      <section aria-labelledby="accountsTitle"><div class="account-list-heading"><div><p class="eyebrow">The flock</p><h2 id="accountsTitle">Registered accounts</h2></div><input id="accountSearch" type="search" placeholder="Search username" aria-label="Search accounts"></div>
      <div class="account-admin-list" id="accountAdminList">${accounts.map(accountCard).join('')||'<p>No accounts found.</p>'}</div></section>
    </main>
    <dialog class="delete-account-dialog" id="deleteAccountDialog" aria-labelledby="deleteAccountTitle"><form method="dialog" id="deleteAccountForm"><button class="dialog-close" type="button" data-delete-cancel aria-label="Close">×</button><p class="eyebrow">Permanent action</p><h2 id="deleteAccountTitle">Delete account?</h2><p>This permanently removes <strong id="deleteAccountName"></strong>, its pigeon and all saved game progress.</p><label for="deleteAccountConfirmation">Type the username to confirm</label><input id="deleteAccountConfirmation" name="confirmation" autocomplete="off" required><div class="delete-dialog-actions"><button type="button" data-delete-cancel>Cancel</button><button class="confirm-delete-button" type="submit" disabled>Delete permanently</button></div></form></dialog>
    <footer class="account-footer">Admin actions are restricted to verified administrators.</footer></body></html>`;
}

module.exports={renderAdminPage};
