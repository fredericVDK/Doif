(()=>{
  'use strict';
  const button=document.getElementById('startBattle');if(!button)return;
  const card=button.closest('.battle-invite'),result=document.getElementById('battleResult');
  const injury=document.getElementById('battleInjury');
  const key=`pigeon-battle:${document.querySelector('[data-pigeon-id]').dataset.pigeonId}`;
  let pending,busy=false,injuredUntil=Date.parse(card.dataset.injuredUntil)||0,cooldownUntil=injuredUntil,timer;try{pending=sessionStorage.getItem(key);}catch{}
  const clearPending=()=>{pending=null;try{sessionStorage.removeItem(key);}catch{}};
  const duration=seconds=>seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;
  const readyTime=value=>new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const startCountdown=()=>{clearInterval(timer);countdown();if(cooldownUntil>Date.now())timer=setInterval(countdown,1000);};
  const countdown=()=>{
    const now=Date.now(),seconds=Math.max(0,Math.ceil((cooldownUntil-now)/1000)),recovering=injuredUntil>now;
    button.disabled=busy||seconds>0;
    button.textContent=recovering?`Recovering · ${duration(seconds)}`:seconds?`Next battle in ${duration(seconds)}`:'Battle →';
    if(injury){injury.hidden=!recovering;injury.textContent=recovering?`Your pigeon can battle again at ${readyTime(injuredUntil)} (in ${duration(seconds)}), or visit the Clinic now.`:'';}
    if(!seconds){injuredUntil=0;clearInterval(timer);}
  };
  const updateStats=stats=>{if(!stats)return;for(const [id,key] of [['battleRank','rank'],['battleWins','wins'],['battleLosses','losses'],['battleAttack','attack'],['battleDefense','defense'],['battleSpeed','speed']]){const el=document.getElementById(id);if(el)el.textContent=stats[key];}};
  button.addEventListener('click',async()=>{
    if(busy)return;pending||=crypto.randomUUID();try{sessionStorage.setItem(key,pending);}catch{}
    busy=true;button.disabled=true;button.textContent='Battling…';result.hidden=false;result.dataset.error='false';result.className='battle-result';result.textContent='The pigeons enter the arena…';card.classList.add('battle-running');
    try{
      const response=await fetch('/api/game/battle',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending}),signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(!response.ok){if([400,401,403,409].includes(response.status))clearPending();if(data.code==='BATTLE_INJURED'){injuredUntil=Date.now()+(Number(data.retryAfter)||30)*1000;cooldownUntil=injuredUntil;startCountdown();}else if(response.status===429){cooldownUntil=Date.now()+(Number(data.retryAfter)||30)*1000;startCountdown();}throw new Error(data.error||'The battle could not be confirmed.');}
      window.PigeonCare?.update(data);window.PigeonUI?.update(data.pigeon);clearPending();updateStats(data.battleStats);
      result.className=`battle-result ${data.won?'battle-win':'battle-loss'}${data.critical?' battle-critical':''}`;
      const critical=data.critical?'Critical hit! ':'';
      result.textContent=data.replayed?'This battle was already saved. Its result was counted once.':data.won?`${critical}${data.pigeon.nickname} defeated Level ${data.opponentLevel} ${data.opponent.name}! +${data.effects.xp} XP · +${data.effects.coins} coins.`:`Level ${data.opponentLevel} ${data.opponent.name} won. ${data.pigeon.nickname} lost ${Math.abs(Number(data.effects.health))} Health and is temporarily injured.`;
      injuredUntil=Date.parse(data.injuredUntil)||0;cooldownUntil=Math.max(Date.now()+30000,injuredUntil);startCountdown();
    }catch(error){result.dataset.error='true';result.textContent=error instanceof TypeError||['TimeoutError','SyntaxError'].includes(error.name)?'We could not confirm the battle. Try again; the same battle only counts once.':error.message;}
    finally{busy=false;card.classList.remove('battle-running');countdown();}
  });
  window.addEventListener('pigeon:clinic-treated',()=>{injuredUntil=0;cooldownUntil=0;clearInterval(timer);countdown();});
  startCountdown();
})();
