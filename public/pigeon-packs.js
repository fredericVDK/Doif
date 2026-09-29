(()=>{
  'use strict';
  const root=document.getElementById('pigeonPacks');if(!root)return;
  const status=document.getElementById('packStatus'),results=document.getElementById('packResults');
  const buttons=[...root.querySelectorAll('[data-pack-buy]')];let busy=false;
  const pending={};
  for(const type of ['normal','big'])try{pending[type]=sessionStorage.getItem(`pigeon-pack:${type}`)||null;}catch{}
  function setMessage(message,error=false){status.textContent=message;status.dataset.error=String(error);}
  function resetText(button){button.textContent=button.dataset.packBuy==='normal'?'Open Normal Pack':'Open Big Pack';}
  function applyAvailability(data){
    window.PigeonCare?.update(data);
    if(data.wallet){const page=document.querySelector('[data-shop-balance]');if(page)window.dispatchEvent(new CustomEvent('pigeon-wallet-updated',{detail:{coins:Number(data.wallet.coins),version:Number(data.wallet.version)}}));}
    for(const pack of data.packs||[]){
      const button=root.querySelector(`[data-pack-buy="${pack.id}"]`);if(!button)continue;
      button.disabled=busy||!pack.available;
      if(!pack.available){const reset=new Date(pack.nextAvailableAt);button.textContent=pack.id==='normal'?'Daily pack opened':'Weekly pack opened';button.title=`Available again ${reset.toLocaleString()}`;}
      else {resetText(button);button.removeAttribute('title');}
    }
  }
  function reveal(data){
    const heading=document.createElement('h3');heading.textContent=data.replayed?'This pack was already saved':'Your pack contains';
    const grid=document.createElement('div');grid.className='pack-reveal-grid';
    for(const item of data.pigeons){
      const card=document.createElement('article');card.className=`pack-pigeon ${item.isNew?'pack-new':'pack-duplicate'}`;
      const image=document.createElement('img');image.src=item.pigeon.image;image.alt='';image.width=180;image.height=130;
      const copy=document.createElement('div'),label=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
      label.textContent=item.isNew?'New discovery':'Duplicate';name.textContent=item.pigeon.name;
      detail.textContent=item.isNew?'Added to your PigeonDex':`+${Number(item.refund)} coins returned`;
      copy.append(label,name,detail);card.append(image,copy);grid.append(card);
    }
    results.replaceChildren(heading,grid);results.hidden=false;
    results.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function json(url,options){
    const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});
    const data=await response.json();if(!response.ok){const error=new Error(data.error||'The pack could not be opened.');error.status=response.status;throw error;}return data;
  }
  async function refresh(){try{const data=await json('/api/game/packs');applyAvailability(data);setMessage('Normal Packs reset daily; Big Packs reset every Monday at 00:00 UTC.');}catch{setMessage('Pack availability is temporarily unavailable.',true);buttons.forEach(button=>button.disabled=true);}}
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-pack-buy]');if(!button||busy||button.disabled)return;
    const type=button.dataset.packBuy;pending[type]||=crypto.randomUUID();try{sessionStorage.setItem(`pigeon-pack:${type}`,pending[type]);}catch{}
    busy=true;buttons.forEach(item=>item.disabled=true);button.textContent='Opening…';results.hidden=true;setMessage('Choosing pigeons for your pack…');
    try{
      const data=await json('/api/game/packs/buy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packType:type,requestId:pending[type]})});
      try{sessionStorage.removeItem(`pigeon-pack:${type}`);}catch{}pending[type]=null;
      window.PigeonCare?.update(data);reveal(data);window.PigeonAchievements?.refresh();
      const duplicates=data.pigeons.filter(item=>!item.isNew).length;
      setMessage(duplicates?`${data.pigeons.length-duplicates} new discoveries. ${duplicates} duplicate${duplicates===1?'':'s'} returned ${Number(data.duplicateRefund)} coins.`:`All ${data.pigeons.length} pigeons are new discoveries!`);
    }catch(error){if(error.status&&error.status<500){try{sessionStorage.removeItem(`pigeon-pack:${type}`);}catch{}pending[type]=null;}setMessage(error.message,true);}
    finally{busy=false;await refresh();}
  });
  refresh();
})();
