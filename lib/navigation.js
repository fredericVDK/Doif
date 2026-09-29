const LINKS=[
  ['home','/','Home'],
  ['my-pigeon','/my-pigeon','My Pigeon'],
  ['pigeondex','/pigeondex.html','PigeonDex'],
  ['shop','/shop','Shop'],
  ['inventory','/inventory','Inventory'],
  ['pigder','/pigder.html','Pigder'],
  ['drawings','/drawings.html','Drawings'],
  ['api','/api-docs.html','API']
];

function renderNavigation(active,{signedIn=false,admin=false}={}) {
  const links=LINKS.map(([id,href,label])=>`<a href="${href}"${active===id?' aria-current="page"':''}>${label}</a>`);
  if(admin) links.push(`<a href="/admin.html"${active==='admin'?' aria-current="page"':''}>Admin</a>`);
  if(signedIn) links.push('<a href="/logout">Sign out</a>');
  return `<nav class="global-nav" aria-label="Site navigation">${links.join('')}</nav>`;
}

module.exports={LINKS,renderNavigation};
