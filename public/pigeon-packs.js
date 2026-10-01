(()=>{
  'use strict';
  const root=document.getElementById('pigeonPacks');
  if(!root)return;

  const JACOBIN_IMAGE='https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/A_Jacobin_Pigeon.JPG/960px-A_Jacobin_Pigeon.JPG';
  const status=document.getElementById('packStatus');
  const results=document.getElementById('packResults');
  const buttons=[...root.querySelectorAll('[data-pack-buy]')];
  const pending={};
  let busy=false;
  let lastTrigger=null;

  for(const type of ['normal','big']){
    try{pending[type]=sessionStorage.getItem(`pigeon-pack:${type}`)||null;}catch{}
  }

  function createOpeningDialog(){
    const modal=document.createElement('div');
    modal.className='pack-opening-modal';
    modal.hidden=true;
    modal.innerHTML=`
      <div class="pack-opening-backdrop"></div>
      <section class="pack-opening-dialog" role="dialog" aria-modal="true" aria-labelledby="packOpeningTitle" aria-describedby="packOpeningMessage">
        <button class="pack-opening-x" type="button" aria-label="Close pack result" hidden>×</button>
        <div class="pack-opening-copy">
          <p class="pack-opening-eyebrow">Pigeon Pack</p>
          <h2 id="packOpeningTitle">Your pack is arriving…</h2>
          <p id="packOpeningMessage" aria-live="polite">Choosing your pigeons.</p>
        </div>
        <div class="pack-opening-theatre">
          <div class="animated-pigeon-pack" aria-hidden="true">
            <div class="pack-tear-strip"><span></span></div>
            <div class="pack-wrapper-top"></div>
            <div class="pack-wrapper-body">
              <span class="pack-shine"></span>
              <img src="${JACOBIN_IMAGE}" alt="">
              <div><small>PIGEON CRUMBS</small><strong>Discovery Pack</strong><span>Featuring the Jacobin pigeon</span></div>
            </div>
          </div>
          <div class="pack-opening-cards" aria-label="Pigeons received"></div>
        </div>
        <div class="pack-opening-actions" hidden>
          <a class="primary-button" href="/pigeondex.html">Go to PigeonDex →</a>
          <button class="pack-close-button" type="button">Close</button>
        </div>
      </section>`;
    document.body.append(modal);
    const close=()=>{
      if(busy&&openingActions.hidden)return;
      modal.classList.add('is-closing');
      window.setTimeout(()=>{
        modal.hidden=true;
        modal.className='pack-opening-modal';
        document.body.classList.remove('pack-animation-open');
        lastTrigger?.focus();
      },180);
    };
    modal.querySelector('.pack-opening-x').addEventListener('click',close);
    modal.querySelector('.pack-close-button').addEventListener('click',close);
    modal.querySelector('.pack-opening-backdrop').addEventListener('click',close);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)close();});
    return modal;
  }

  const openingDialog=createOpeningDialog();
  const openingTitle=openingDialog.querySelector('#packOpeningTitle');
  const openingMessage=openingDialog.querySelector('#packOpeningMessage');
  const openingCards=openingDialog.querySelector('.pack-opening-cards');
  const openingActions=openingDialog.querySelector('.pack-opening-actions');
  const openingX=openingDialog.querySelector('.pack-opening-x');
  const rarities=new Set(['common','uncommon','rare','epic','legendary']);

  function rarityOf(item){
    const rarity=String(item?.pigeon?.gameRarity||'common').toLowerCase();
    return rarities.has(rarity)?rarity:'common';
  }

  function rarityLabel(rarity){
    return rarity.charAt(0).toUpperCase()+rarity.slice(1);
  }

  function makeFirework(){
    const firework=document.createElement('div');
    firework.className='rarity-firework';firework.setAttribute('aria-hidden','true');
    for(let spark=0;spark<12;spark++){
      const particle=document.createElement('i');
      particle.style.setProperty('--spark-index',spark);firework.append(particle);
    }
    return firework;
  }

  function startOpening(type,trigger){
    lastTrigger=trigger;
    openingDialog.className=`pack-opening-modal pack-opening-${type}`;
    openingDialog.hidden=false;
    openingCards.replaceChildren();
    openingActions.hidden=true;
    openingActions.querySelector('a').hidden=false;
    openingX.hidden=true;
    openingTitle.textContent=type==='big'?'Your Big Pack is arriving…':'Your Normal Pack is arriving…';
    openingMessage.textContent='Choosing your pigeons.';
    document.body.classList.add('pack-animation-open');
    requestAnimationFrame(()=>openingDialog.classList.add('is-loading'));
  }

  function buildPigeonCard(item,index){
    const rarity=rarityOf(item);
    const card=document.createElement('article');
    card.className=`opening-pigeon-card ${item.isNew?'is-new':'is-duplicate'} rarity-${rarity}`;
    card.style.setProperty('--card-index',index);
    const image=document.createElement('img');
    image.src=item.pigeon.image;
    image.alt='';
    const badges=document.createElement('div');badges.className='opening-card-badges';
    const badge=document.createElement('span');badge.className='opening-status-badge';
    badge.textContent=item.isNew?'New':'Duplicate';
    const rarityBadge=document.createElement('span');rarityBadge.className=`pack-rarity-badge rarity-${rarity}`;
    rarityBadge.textContent=rarityLabel(rarity);badges.append(badge,rarityBadge);
    const name=document.createElement('strong');
    name.textContent=item.pigeon.name;
    const detail=document.createElement('small');
    detail.textContent=item.isNew?'Added to your PigeonDex':`+${Number(item.refund)} coins returned`;
    card.append(image,badges,name,detail);
    if(rarity==='epic'||rarity==='legendary')card.append(makeFirework());
    return card;
  }

  function wait(milliseconds){
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return new Promise(resolve=>window.setTimeout(resolve,reduced?Math.min(milliseconds,40):milliseconds));
  }

  async function animateReveal(data,startedAt){
    const remaining=Math.max(0,850-(Date.now()-startedAt));
    if(remaining)await wait(remaining);
    openingTitle.textContent='Tear it open!';
    openingMessage.textContent='Your pigeons are ready.';
    openingDialog.classList.remove('is-loading');
    openingDialog.classList.add('is-tearing');
    await wait(720);
    openingCards.style.setProperty('--pack-card-count',data.pigeons.length);
    data.pigeons.forEach((item,index)=>openingCards.append(buildPigeonCard(item,index)));
    openingTitle.textContent=data.replayed?'Your saved pack':'Meet your new pigeons!';
    openingMessage.textContent=data.pigeons.some(item=>!item.isNew)
      ?'New discoveries and duplicate rewards have been saved.'
      :'Every pigeon in this pack is a new discovery.';
    openingDialog.classList.add('is-revealing');
    await wait(500+data.pigeons.length*150);
    openingDialog.classList.add('is-complete');
    openingActions.hidden=false;
    openingX.hidden=false;
    openingDialog.querySelector('.pack-close-button').focus();
  }

  function showOpeningError(message){
    openingDialog.classList.remove('is-loading');
    openingDialog.classList.add('has-error');
    openingTitle.textContent='The pack stayed closed';
    openingMessage.textContent=message;
    openingActions.hidden=false;
    openingActions.querySelector('a').hidden=true;
    openingX.hidden=false;
  }

  function setMessage(message,error=false){
    status.textContent=message;
    status.dataset.error=String(error);
  }

  function resetText(button){
    button.textContent=button.dataset.packBuy==='normal'?'Open Normal Pack':'Open Big Pack';
  }

  function applyAvailability(data){
    window.PigeonCare?.update(data);
    if(data.wallet){
      const page=document.querySelector('[data-shop-balance]');
      if(page)window.dispatchEvent(new CustomEvent('pigeon-wallet-updated',{detail:{coins:Number(data.wallet.coins),version:Number(data.wallet.version)}}));
    }
    for(const pack of data.packs||[]){
      const button=root.querySelector(`[data-pack-buy="${pack.id}"]`);
      if(!button)continue;
      button.disabled=busy||!pack.available;
      if(!pack.available){
        const reset=new Date(pack.nextAvailableAt);
        button.textContent=pack.id==='normal'?'Daily pack opened':'Weekly pack opened';
        button.title=`Available again ${reset.toLocaleString()}`;
      }else{
        resetText(button);
        button.removeAttribute('title');
      }
    }
  }

  function reveal(data){
    const heading=document.createElement('h3');
    heading.textContent=data.replayed?'This pack was already saved':'Your latest pack';
    const grid=document.createElement('div');
    grid.className='pack-reveal-grid';
    for(const item of data.pigeons){
      const rarity=rarityOf(item);
      const card=document.createElement('article');
      card.className=`pack-pigeon ${item.isNew?'pack-new':'pack-duplicate'} rarity-${rarity}`;
      const image=document.createElement('img');
      image.src=item.pigeon.image;image.alt='';image.width=180;image.height=130;
      const copy=document.createElement('div'),badges=document.createElement('div'),label=document.createElement('span'),rarityBadge=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
      badges.className='pack-result-badges';label.className='pack-status-badge';rarityBadge.className=`pack-rarity-badge rarity-${rarity}`;
      label.textContent=item.isNew?'New discovery':'Duplicate';name.textContent=item.pigeon.name;
      rarityBadge.textContent=rarityLabel(rarity);badges.append(label,rarityBadge);
      detail.textContent=item.isNew?'Added to your PigeonDex':`+${Number(item.refund)} coins returned`;
      copy.append(badges,name,detail);card.append(image,copy);grid.append(card);
    }
    results.replaceChildren(heading,grid);results.hidden=false;
  }

  async function json(url,options){
    const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'The pack could not be opened.');error.status=response.status;throw error;}
    return data;
  }

  async function refresh(updateStatus=true){
    try{
      const data=await json('/api/game/packs');
      applyAvailability(data);
      if(updateStatus)setMessage('Normal Packs reset daily; Big Packs reset every Monday at 00:00 UTC.');
    }catch{
      setMessage('Pack availability is temporarily unavailable.',true);
      buttons.forEach(button=>button.disabled=true);
    }
  }

  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-pack-buy]');
    if(!button||busy||button.disabled)return;
    const type=button.dataset.packBuy;
    const startedAt=Date.now();
    pending[type]||=crypto.randomUUID();
    try{sessionStorage.setItem(`pigeon-pack:${type}`,pending[type]);}catch{}
    busy=true;
    buttons.forEach(item=>item.disabled=true);
    button.textContent='Opening…';
    results.hidden=true;
    setMessage('Choosing pigeons for your pack…');
    startOpening(type,button);
    try{
      const data=await json('/api/game/packs/buy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packType:type,requestId:pending[type]})});
      try{sessionStorage.removeItem(`pigeon-pack:${type}`);}catch{}
      pending[type]=null;
      window.PigeonCare?.update(data);
      reveal(data);
      window.PigeonAchievements?.refresh();
      const duplicates=data.pigeons.filter(item=>!item.isNew).length;
      setMessage(duplicates?`${data.pigeons.length-duplicates} new discoveries. ${duplicates} duplicate${duplicates===1?'':'s'} returned ${Number(data.duplicateRefund)} coins.`:`All ${data.pigeons.length} pigeons are new discoveries!`);
      await animateReveal(data,startedAt);
    }catch(error){
      if(error.status&&error.status<500){try{sessionStorage.removeItem(`pigeon-pack:${type}`);}catch{}pending[type]=null;}
      setMessage(error.message,true);
      showOpeningError(error.message);
    }finally{
      busy=false;
      await refresh(false);
    }
  });

  refresh();
})();
