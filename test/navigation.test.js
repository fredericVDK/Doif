const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const {LINKS,PUBLIC_LINKS,TAMAGOTCHI_LINKS,renderNavigation}=require('../lib/navigation');
const {renderAuthPage}=require('../lib/auth/pages');
const {renderInventoryPage,renderShopPage}=require('../lib/game/pages');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const core=[
  ['home','/','Home'],['my-pigeon','/my-pigeon','My Pigeon'],['pigeondex','/pigeondex.html','PigeonDex'],
  ['shop','/shop','Shop'],['inventory','/inventory','Inventory'],['pigder','/pigder.html','Pigder'],
  ['drawings','/drawings.html','Drawings'],['api','/api-docs.html','API']
];
function nav(html) {const match=html.match(/<nav class="[^"]*global-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/);assert.ok(match,'global navigation exists');return match[0];}
function anchors(html) {return [...html.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(match=>({href:match[1],attrs:match[2],label:match[3]}));}

test('central navigation defines the requested destinations in one stable order',()=>{
  assert.deepEqual(LINKS,core);
  assert.deepEqual(TAMAGOTCHI_LINKS.map(([,href,label])=>[href,label]),[
    ['/my-pigeon','My Pigeon'],['/shop','Shop'],['/inventory','Inventory']
  ]);
  const basic=anchors(renderNavigation('home'));
  assert.deepEqual(basic.map(({href,label})=>[href,label]),[
    ...PUBLIC_LINKS.map(([,href,label])=>[href,label]),['/sign-in','Login']
  ]);
  assert.doesNotMatch(renderNavigation(),/My Pigeon|Shop|Inventory|Sign out|Admin/);
  assert.match(renderNavigation(),/href="\/sign-in" class="login-link">Login/);
  const signedIn=anchors(renderNavigation('shop',{signedIn:true}));
  assert.deepEqual(signedIn.slice(0,-1).map(({href,label})=>[href,label]),core.map(([,href,label])=>[href,label]));
  assert.equal(signedIn.find(link=>link.label==='Shop').attrs.includes('aria-current="page"'),true);
  assert.equal(signedIn.at(-1).label,'Sign out');
  assert.match(renderNavigation('admin',{admin:true}),/href="\/admin\.html" aria-current="page">Admin/);
});

test('public pages start with public links and login without exposing Tamagotchi links',()=>{
  const pages=[
    ['public/index.html','Home'],['public/pigeondex.html','PigeonDex'],['public/pigder.html','Pigder'],
    ['public/drawings.html','Drawings'],['public/api-docs.html','API'],['public/admin.html',null]
  ];
  for(const [file,current] of pages) {
    const html=read(file),links=anchors(nav(html));
    assert.deepEqual(links.map(({href,label})=>[href,label]),[
      ...PUBLIC_LINKS.map(([,href,label])=>[href,label]),['/sign-in','Login']
    ],file);
    assert.doesNotMatch(nav(html),/My Pigeon|Shop|Inventory/,file);
    const selected=links.find(link=>link.attrs.includes('aria-current="page"'));
    assert.equal(selected?.label,current||undefined,file);
    assert.match(html,/site-navigation\.css/,file);
    assert.match(html,/site-navigation\.js/,file);
  }
});

test('authentication and game pages use the same nav with contextual account actions',()=>{
  const auth=renderAuthPage('sign-in',{configured:true});
  assert.deepEqual(anchors(nav(auth)).map(({label})=>label),[...PUBLIC_LINKS.map(([, ,label])=>label),'Login']);
  const logout=renderAuthPage('logout',{configured:true,user:{id:'u',email:'a@b.test'}});
  assert.equal(anchors(nav(logout)).at(-1).label,'Sign out');
  const inventory={items:[],summary:{distinctOwned:0,totalQuantity:0}};
  const inventoryHtml=renderInventoryPage(inventory,{username:'Bird',coins:10,coins_version:0});
  const shopHtml=renderShopPage(inventory,{username:'Bird',coins:10,coins_version:0});
  assert.equal(anchors(nav(inventoryHtml)).find(link=>link.attrs.includes('aria-current')).label,'Inventory');
  assert.equal(anchors(nav(shopHtml)).find(link=>link.attrs.includes('aria-current')).label,'Shop');
  for(const html of [auth,logout,inventoryHtml,shopHtml]) assert.match(html,/site-navigation\.css/);
});

test('mobile navigation remains a single keyboard-accessible horizontal row',()=>{
  const css=read('public/site-navigation.css');
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/flex-wrap:nowrap/); assert.match(css,/overflow-x:auto/);
  assert.match(css,/scroll-snap-type:x proximity/); assert.match(css,/:focus-visible/);
  assert.match(read('server.js'),/"site-navigation\.css"/);
  assert.match(read('server.js'),/"site-navigation\.js"/);
  assert.match(read('test-support/preview-adoption.js'),/"\/site-navigation\.css"/);
});

test('public navigation upgrades after a verified account session',()=>{
  const script=read('public/site-navigation.js');
  assert.match(script,/fetch\('\/api\/auth\/session'/);
  assert.match(script,/credentials: 'same-origin'/);
  assert.match(script,/Boolean\(session\?\.user\)/);
  for(const label of ['My Pigeon','Shop','Inventory','Sign out','Login']) assert.match(script,new RegExp(label));
});

test('all navigation targets resolve to existing public files or owned application routes',()=>{
  const routeTargets=new Set(['/','/my-pigeon','/shop','/inventory']);
  for(const [,href] of core) {
    if(routeTargets.has(href)) continue;
    assert.equal(fs.existsSync(path.join(__dirname,'..','public',href.slice(1))),true,href);
  }
});
