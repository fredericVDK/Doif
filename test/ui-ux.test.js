const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runInNewContext}=require('node:vm');
const {renderPigeonPage}=require('../lib/game/pages');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

const pigeon={
  id:'pigeon-1',version:1,nickname:'Gilbert',level:2,xp:15,growth_stage:'hatchling',
  health:88,hunger:20,happiness:82,energy:18,cleanliness:12,last_updated:'2026-09-29T10:00:00Z',
  species:{id:'jacobin-pigeon',name:'Jacobin pigeon',scientific_name:'Columba livia',kind:'breed',image:'/assets/pigeon-hero-wide.png',source_url:'https://example.test/bird',image_attribution:{sourceUrl:'https://example.test/photo'}}
};

test('dashboard centers the pigeon and exposes clear saved-state labels and shortcut cards',()=>{
  const html=renderPigeonPage(pigeon,{username:'Bird',coins:50,coins_version:1});
  assert.match(html,/id="pigeonHero" data-pigeon-state="happy hungry dirty tired"/);
  assert.match(html,/data-mood-label>Happy · Hungry · Needs a wash · Tired/);
  assert.match(html,/class="pigeon-scene"/);
  assert.match(html,/class="roost-shortcuts" aria-label="Roost essentials"/);
  assert.match(html,/href="\/inventory"[\s\S]*>Inventory</);
  assert.match(html,/href="\/shop"[\s\S]*>Shop</);
  assert.match(html,/src="\/pigeon-ui\.js" defer/);
});

test('client presentation state follows authoritative pigeon values',()=>{
  const hero={dataset:{pigeonState:'calm'},classList:{remove(){},add(){}}};
  const mood={textContent:'Content'};
  const dashboard={};
  const window={};
  runInNewContext(read('public/pigeon-ui.js'),{
    window,document:{
      querySelector:selector=>selector==='[data-pigeon-id]'?dashboard:selector==='[data-mood-label]'?mood:null,
      getElementById:id=>id==='pigeonHero'?hero:null
    },setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:callback=>callback()
  });
  assert.deepEqual(Array.from(window.PigeonUI.states({happiness:80,hunger:10,cleanliness:10,energy:10})),['happy','hungry','dirty','tired']);
  window.PigeonUI.update({happiness:40,hunger:80,cleanliness:90,energy:90});
  assert.equal(hero.dataset.pigeonState,'calm');
  assert.equal(mood.textContent,'Content');
});

test('care feedback has restrained responsive motion with a reduced-motion fallback',()=>{
  const css=read('public/pigeon-dashboard.css');
  for(const animation of ['crumb-drop','pigeon-hop','sparkle-pop','sleep-float','level-glow']) assert.match(css,new RegExp(`@keyframes ${animation}`));
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/@media \(max-width: 620px\)[\s\S]*\.roost-shortcuts \{ grid-template-columns:1fr/);
  for(const [file,action] of [['public/pigeon-feed.js','feeding'],['public/pigeon-play.js','playing'],['public/pigeon-clean.js','cleaning'],['public/pigeon-sleep.js','sleeping']]) {
    assert.match(read(file),new RegExp(`PigeonUI\\?\\.animate\\(\"${action}\"`),file);
  }
  assert.match(read('public/pigeon-discovery.css'),/@keyframes discovery-arrive/);
  assert.match(read('server.js'),/"pigeon-ui\.js"/);
});
