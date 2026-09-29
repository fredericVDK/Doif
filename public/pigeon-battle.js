(()=>{
  'use strict';
  const button=document.getElementById('startBattle');if(!button)return;
  const result=document.getElementById('battleResult');
  const key=`pigeon-battle:${document.querySelector('[data-pigeon-id]').dataset.pigeonId}`;
  let pending,busy=false,cooldownUntil=0,timer;
  try{pending=sessionStorage.getItem(key);}catch{}
  const clearPending=()=>{pending=null;try{sessionStorage.removeItem(key);}catch{}};
  function countdown(){const seconds=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));button.disabled=busy||seconds>0;button.textContent=seconds?`Next battle in ${seconds}s`:'Battle →';if(!seconds)clearInterval(timer);}
  button.addEventListener('click',async()=>{
    if(busy||Date.now()<cooldownUntil)return;
    pending||=crypto.randomUUID();try{sessionStorage.setItem(key,pending);}catch{}
    busy=true;result.hidden=false;result.dataset.error='false';result.textContent='Feathers are flying…';countdown();
    try{
      const response=await fetch('/api/game/battle',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending}),signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(!response.ok){if([400,401,403,409].includes(response.status))clearPending();if(response.status===429){cooldownUntil=Date.now()+(Number(data.retryAfter)||30)*1000;clearInterval(timer);timer=setInterval(countdown,1000);}throw new Error(data.error||'The battle could not be confirmed.');}
      window.PigeonCare.update(data);window.PigeonUI?.animate('playing',data.pigeon);
      result.className=`battle-result ${data.won?'battle-win':'battle-loss'}`;
      result.textContent=data.replayed?`This battle was already saved. Its result was counted once.`:data.won?`${data.pigeon.nickname} defeated Level ${data.opponentLevel} ${data.opponent.name}! +${data.effects.xp} XP`:`Level ${data.opponentLevel} ${data.opponent.name} won. No XP and ${data.effects.health} Health — care for ${data.pigeon.nickname} and try again.`;
      clearPending();cooldownUntil=Date.now()+30000;clearInterval(timer);timer=setInterval(countdown,1000);
    }catch(error){result.dataset.error='true';result.textContent=error instanceof TypeError||error.name==='TimeoutError'||error.name==='SyntaxError'?'We could not confirm the battle. Try again; the same battle only counts once.':error.message;}
    finally{busy=false;countdown();}
  });
})();
