const PUBLIC_LINKS=[
  ['home','/','Home'],
  ['pigeondex','/pigeondex.html','PigeonDex'],
  ['pigder','/pigder.html','Pigder'],
  ['drawings','/drawings.html','Drawings'],
  ['api','/api-docs.html','API']
];
const TAMAGOTCHI_LINKS=[
  ['my-pigeon','/my-pigeon','My Pigeon'],
  ['shop','/shop','Shop'],
  ['inventory','/inventory','Inventory']
  ,['profile','/profile','Profile']
];
const LINKS=[PUBLIC_LINKS[0],TAMAGOTCHI_LINKS[0],PUBLIC_LINKS[1],TAMAGOTCHI_LINKS[1],TAMAGOTCHI_LINKS[2],TAMAGOTCHI_LINKS[3]];

function renderNavigation(active,{signedIn=false,admin=false}={}) {
  const visible=signedIn?LINKS:PUBLIC_LINKS;
  const links=visible.map(([id,href,label])=>`<a href="${href}"${active===id?' aria-current="page"':''}>${label}</a>`);
  if(admin) links.push(`<a href="/admin.html"${active==='admin'?' aria-current="page"':''}>Admin</a>`);
  links.push(signedIn?'<a href="/logout">Sign out</a>':`<a href="/sign-in" class="login-link"${active==='login'?' aria-current="page"':''}>Login</a>`);
  return `<nav class="global-nav" aria-label="Site navigation">${links.join('')}</nav>`;
}

module.exports={LINKS,PUBLIC_LINKS,TAMAGOTCHI_LINKS,renderNavigation};
