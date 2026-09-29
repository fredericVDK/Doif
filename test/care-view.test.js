const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {runInNewContext} = require("node:vm");

test("coin balance uses its own saved revision across delayed actions, rest and retries", () => {
  const elements={coinsValue:{textContent:"48"},pigeonStats:{},xpValue:{},savedStatus:{},levelValue:{},xpProgress:{},growthStage:{},levelFeedback:{}};
  const window={};
  runInNewContext(readFileSync(join(__dirname,"../public/pigeon-care.js"),"utf8"), {
    window,document:{querySelector:()=>({dataset:{pigeonVersion:"1",pigeonLevel:"1",coinsVersion:"0"}}),getElementById:id=>elements[id]}
  });
  const result=(version,wallet)=>({wallet,statsHtml:`stats ${version}`,pigeon:{version,level:1,xp:0,last_updated:"2026-09-28T00:00:00Z"}});
  window.PigeonCare.update(result(4)); // Sleep can arrive before an earlier earning action.
  window.PigeonCare.update(result(3,{coins:55,version:2}));
  assert.equal(elements.coinsValue.textContent,"55");
  assert.equal(elements.pigeonStats.innerHTML,"stats 4");
  window.PigeonCare.update(result(2,{coins:50,version:1}));
  assert.equal(elements.coinsValue.textContent,"55");
  window.PigeonCare.update({...result(5,{coins:55,version:2}),replayed:true});
  assert.equal(elements.coinsValue.textContent,"55");
  window.PigeonCare.update(result(6,{coins:57,version:3}));
  assert.equal(elements.coinsValue.textContent,"57");
});

test("delayed Feed or Play responses cannot repaint older stats and XP", () => {
  const elements = {pigeonStats:{},xpValue:{},savedStatus:{},levelValue:{},xpProgress:{},growthStage:{},levelFeedback:{}};
  const window = {};
  runInNewContext(readFileSync(join(__dirname,"../public/pigeon-care.js"),"utf8"), {
    window, document: {
      querySelector:()=>({dataset:{pigeonVersion:"3",pigeonLevel:"1"}}),
      getElementById:id=>elements[id]
    }
  });
  const result = (version,xp) => ({statsHtml:`stats at version ${version}`,pigeon:{version,xp,level:1,last_updated:"2026-09-20T00:00:00Z"}});
  window.PigeonCare.update(result(5,15));
  window.PigeonCare.update(result(4,5));
  assert.equal(elements.xpValue.textContent,"15");
  assert.equal(elements.pigeonStats.innerHTML,"stats at version 5");
  window.PigeonCare.update(result(6,25));
  assert.equal(elements.xpValue.textContent,"25");
});

test("growth badge and announcement follow new stages once without stale repainting", () => {
  const elements={pigeonStats:{},xpValue:{},savedStatus:{},levelValue:{},xpProgress:{},growthStage:{},levelFeedback:{hidden:true}};
  const window={};
  runInNewContext(readFileSync(join(__dirname,"../public/pigeon-care.js"),"utf8"), {
    window,document:{querySelector:()=>({dataset:{pigeonVersion:"1",pigeonLevel:"4",pigeonStage:"hatchling"}}),getElementById:id=>elements[id]}
  });
  const result=(version,level,stage,label)=>({statsHtml:"stats",xpHtml:"xp",growthHtml:`badge ${stage}`,growthLabel:label,
    pigeon:{version,level,growth_stage:stage,xp:0,nickname:"Gilbert",last_updated:"2026-09-25T00:00:00Z"}});
  window.PigeonCare.update(result(2,5,"juvenile","Juvenile"));
  assert.equal(elements.growthStage.innerHTML,"badge juvenile");
  assert.equal(elements.levelFeedback.textContent,"Gilbert reached Level 5! Growth stage: Juvenile.");
  elements.levelFeedback.hidden=true;
  window.PigeonCare.update({...result(3,5,"juvenile","Juvenile"),replayed:true});
  assert.equal(elements.levelFeedback.hidden,true);
  window.PigeonCare.update(result(1,4,"hatchling","Hatchling"));
  assert.equal(elements.growthStage.innerHTML,"badge juvenile");
  window.PigeonCare.update(result(4,25,"best_friend","Best Friend"));
  assert.equal(elements.growthStage.innerHTML,"badge best_friend");
  assert.equal(elements.levelFeedback.textContent,"Gilbert reached Level 25! Growth stage: Best Friend.");
});

test("level notification follows saved state once, including retries and out-of-order responses", () => {
  const elements={pigeonStats:{},xpValue:{},savedStatus:{},levelValue:{},xpProgress:{},growthStage:{},levelFeedback:{hidden:true}};
  const window={};
  runInNewContext(readFileSync(join(__dirname,"../public/pigeon-care.js"),"utf8"), {
    window,document:{querySelector:()=>({dataset:{pigeonVersion:"1",pigeonLevel:"1"}}),getElementById:id=>elements[id]}
  });
  const result=(version,level,xp)=>({statsHtml:"stats",xpHtml:`${xp} XP progress`,pigeon:{version,level,xp,nickname:"Gilbert <3",last_updated:"2026-09-25T00:00:00Z"}});
  window.PigeonCare.update(result(3,2,3));
  assert.equal(elements.levelValue.textContent,"2");
  assert.equal(elements.levelFeedback.textContent,"Gilbert <3 reached Level 2!");
  assert.equal(elements.levelFeedback.hidden,false);
  elements.levelFeedback.hidden=true;
  window.PigeonCare.update({...result(4,2,3),replayed:true});
  assert.equal(elements.levelFeedback.hidden,true,"A retry must not repeat the announcement");
  window.PigeonCare.update(result(2,1,98));
  assert.equal(elements.levelValue.textContent,"2");
  assert.equal(elements.xpValue.textContent,"3");
  window.PigeonCare.update(result(5,4,50));
  assert.equal(elements.levelFeedback.textContent,"Gilbert <3 reached Level 4!");
  assert.equal(elements.xpProgress.innerHTML,"50 XP progress");
});

test("rest clears a stale tired message only when current energy permits Play", () => {
  const feedback = {dataset:{code:"TOO_TIRED"},hidden:false};
  const elements = {pigeonStats:{},xpValue:{},savedStatus:{},levelValue:{},xpProgress:{},growthStage:{},levelFeedback:{},playFeedback:feedback};
  const window = {};
  runInNewContext(readFileSync(join(__dirname,"../public/pigeon-care.js"),"utf8"), {
    window, document: {querySelector:()=>({dataset:{pigeonVersion:"3",pigeonLevel:"1"}}),getElementById:id=>elements[id]}
  });
  const result = (version,energy) => ({statsHtml:"stats",pigeon:{version,energy,xp:0,level:1,last_updated:"2026-09-25T00:00:00Z"}});
  window.PigeonCare.update(result(4,5));
  assert.equal(feedback.hidden,false);
  window.PigeonCare.update(result(3,30));
  assert.equal(feedback.hidden,false,"A stale response must not hide the current tired message");
  window.PigeonCare.update(result(5,30));
  assert.equal(feedback.hidden,true);
  feedback.hidden=false; feedback.dataset.code="PLAY_STORAGE";
  window.PigeonCare.update(result(6,30));
  assert.equal(feedback.hidden,false,"Connection errors must remain visible for safe retry");
});
