(()=>{
  'use strict';
  const button=document.getElementById('visitClinic');if(!button)return;
  const result=document.getElementById('clinicResult');
  const key=`pigeon-clinic:${document.querySelector('[data-pigeon-id]').dataset.pigeonId}`;
  let pending,busy=false;try{pending=sessionStorage.getItem(key);}catch{}
  const clear=()=>{pending=null;try{sessionStorage.removeItem(key);}catch{}};
  const message=(text,error=false)=>{result.hidden=false;result.dataset.error=String(error);result.textContent=text;};
  button.addEventListener('click',async()=>{
    if(busy)return;pending||=crypto.randomUUID();try{sessionStorage.setItem(key,pending);}catch{}
    busy=true;button.disabled=true;button.textContent='Treating…';message('The clinic is taking gentle care of your pigeon…');
    try{
      const response=await fetch('/api/game/clinic',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending}),signal:AbortSignal.timeout(20000)});
      const data=await response.json();
      if(!response.ok){if(response.status<500)clear();throw new Error(data.error||'The clinic visit could not be confirmed.');}
      window.PigeonCare?.update(data);window.PigeonUI?.update(data.pigeon);clear();
      message(data.replayed?'This clinic visit was already saved and charged once.':`${data.pigeon.nickname} is back at 100 Health! +${Number(data.effects.health)} Health · ${Math.abs(Number(data.effects.coins))} coins spent.`);
    }catch(error){message(error instanceof TypeError||['TimeoutError','SyntaxError'].includes(error.name)?'We could not confirm the clinic visit. Try again; the same visit only counts once.':error.message,true);}
    finally{busy=false;button.disabled=false;button.textContent='Visit clinic · ◉ 100';}
  });
})();
