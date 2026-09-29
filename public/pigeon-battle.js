(()=>{
  'use strict';
  const form=document.getElementById('pigeonBattleForm');if(!form)return;
  const button=document.getElementById('startBattle'),result=document.getElementById('battleResult');
  const key=`pigeon-battle:${document.querySelector('[data-pigeon-id]').dataset.pigeonId}`;
  let pending,busy=false,cooldownUntil=0,timer;
  try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
  const clearPending=()=>{pending=null;try{sessionStorage.removeItem(key);}catch{}};
  function countdown(){const seconds=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));button.disabled=busy||seconds>0;button.textContent=seconds?`Next battle in ${seconds}s`:'Fight for XP →';if(!seconds)clearInterval(timer);}
  form.addEventListener('change',clearPending);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||Date.now()<cooldownUntil||!form.reportValidity())return;
    const opponentSpeciesId=form.elements.opponentSpeciesId.value;
    if(!pending||pending.opponentSpeciesId!==opponentSpeciesId)pending={opponentSpeciesId,requestId:crypto.randomUUID()};
    try{sessionStorage.setItem(key,JSON.stringify(pending));}catch{}
    busy=true;form.querySelector('fieldset').disabled=true;result.hidden=false;result.dataset.error='false';result.textContent='Feathers are flying…';countdown();
    try{
      const response=await fetch('/api/game/battle',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(pending),signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(!response.ok){if([400,401,403,409].includes(response.status))clearPending();if(response.status===429){cooldownUntil=Date.now()+(Number(data.retryAfter)||30)*1000;timer=setInterval(countdown,1000);}throw new Error(data.error||'The battle could not be confirmed.');}
      document.getElementById('battleLevel').textContent=data.pigeon.level;document.getElementById('battleXp').textContent=data.pigeon.xp;document.getElementById('battleEnergy').textContent=Math.floor(Number(data.pigeon.energy));
      result.className=`battle-result ${data.won?'battle-win':'battle-loss'}`;
      result.textContent=data.replayed?`This battle was already saved. ${data.effects.xp} XP was counted once.`:data.won?`${data.pigeon.nickname} defeated ${data.opponent.name}! +${data.effects.xp} XP`:`${data.opponent.name} won this round, but ${data.pigeon.nickname} earned +${data.effects.xp} XP.`;
      clearPending();cooldownUntil=Date.now()+30000;clearInterval(timer);timer=setInterval(countdown,1000);
    }catch(error){result.dataset.error='true';result.textContent=error instanceof TypeError||error.name==='TimeoutError'||error.name==='SyntaxError'?'We could not confirm the battle. Try again; the same battle only counts once.':error.message;}
    finally{busy=false;form.querySelector('fieldset').disabled=false;countdown();}
  });
})();
