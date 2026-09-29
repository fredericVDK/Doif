(() => {
  "use strict";
  const dashboard=document.querySelector("[data-pigeon-id]");
  const hero=document.getElementById("pigeonHero");
  const mood=document.querySelector("[data-mood-label]");
  if(!dashboard||!hero||!mood) return;

  const labels={happy:"Happy",hungry:"Hungry",dirty:"Needs a wash",tired:"Tired",sleeping:"Sleeping",calm:"Content"};
  let lastPigeon=null, effectTimer;
  function states(pigeon={}) {
    const found=[];
    if(Number(pigeon.happiness)>=70) found.push("happy");
    if(Number(pigeon.hunger)<30) found.push("hungry");
    if(Number(pigeon.cleanliness)<30) found.push("dirty");
    if(Number(pigeon.energy)<30) found.push("tired");
    return found.length?found:["calm"];
  }
  function paint(list) {
    hero.dataset.pigeonState=list.join(" ");
    mood.textContent=list.map(state=>labels[state]).join(" · ");
  }
  function update(pigeon) {
    lastPigeon=pigeon;
    if(!hero.dataset.action) paint(states(pigeon));
  }
  function animate(action,pigeon) {
    if(pigeon) lastPigeon=pigeon;
    clearTimeout(effectTimer);
    hero.dataset.action=action;
    if(action==="sleeping") paint(["sleeping"]);
    effectTimer=setTimeout(()=>{
      delete hero.dataset.action;
      if(lastPigeon) paint(states(lastPigeon));
    }, action==="sleeping"?1900:1300);
  }
  function levelUp() {
    hero.classList.remove("is-leveling");
    requestAnimationFrame(()=>hero.classList.add("is-leveling"));
    setTimeout(()=>hero.classList.remove("is-leveling"),1500);
  }
  window.PigeonUI={states,update,animate,levelUp};
})();
