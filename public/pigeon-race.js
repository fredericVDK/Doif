(()=>{
  'use strict';
  const page=document.querySelector('.race-page');if(!page)return;
  const setup=document.getElementById('raceSetup'),live=document.getElementById('raceLive');
  const origin=document.getElementById('raceOrigin'),destination=document.getElementById('raceDestination');
  const start=document.getElementById('startRace'),status=document.getElementById('raceStatus');
  const distanceEl=document.getElementById('raceDistance'),durationEl=document.getElementById('raceDuration');
  const rewardCoins=document.getElementById('raceRewardCoins'),rewardXp=document.getElementById('raceRewardXp'),netReward=document.getElementById('raceNetReward');
  const wallet=document.getElementById('raceCoins'),entryCost=Number(page.dataset.entryCost)||100;
  const pendingKey='pigeon-race:request';let pending,busy=false,activeRace,countdownTimer,pollTimer,collecting=false,resultShown=false;
  try{pending=sessionStorage.getItem(pendingKey);}catch{}

  const formatNumber=value=>Number(value).toLocaleString('en');
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
  function formatDuration(seconds){
    const total=Math.max(0,Math.ceil(Number(seconds)||0)),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),secs=total%60;
    if(hours)return `${hours}h ${minutes}m`;
    if(minutes)return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
  function selectedOpponent(){return document.querySelector('input[name="raceOpponent"]:checked');}
  function radians(value){return value*Math.PI/180;}
  function routeQuote(){
    const from=origin.selectedOptions[0],to=destination.selectedOptions[0],opponent=selectedOpponent();
    if(!from||!to||!opponent||from.value===to.value)return null;
    const lat1=radians(Number(from.dataset.latitude)),lat2=radians(Number(to.dataset.latitude));
    const dLat=lat2-lat1,dLon=radians(Number(to.dataset.longitude)-Number(from.dataset.longitude));
    const a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    const distance=Math.max(1,Math.round(6371*2*Math.asin(Math.sqrt(a))));
    const duration=Math.max(15,Math.min(720,Math.round(12+distance/16)))*60;
    const level=Math.max(1,Number(opponent.dataset.level)||1);
    return{distance,duration,coins:Math.min(2000,120+Math.ceil(distance/6)+level*6),xp:Math.min(600,20+Math.ceil(distance/30)+level*3)};
  }
  function updatePreview(){
    const quote=routeQuote();
    if(!quote){distanceEl.textContent='Choose different cities';durationEl.textContent='—';rewardCoins.textContent='—';rewardXp.textContent='—';netReward.textContent='';start.disabled=true;return;}
    distanceEl.textContent=`${formatNumber(quote.distance)} km`;durationEl.textContent=formatDuration(quote.duration);
    rewardCoins.textContent=`◉ ${formatNumber(quote.coins)}`;rewardXp.textContent=formatNumber(quote.xp);
    netReward.textContent=`Net profit after the entry fee: ◉ ${formatNumber(quote.coins-entryCost)}`;
    start.disabled=busy||!selectedOpponent();
  }
  function setStatus(message,error=false){status.textContent=message;status.dataset.error=String(error);}
  function updateWallet(data){
    if(!data?.wallet)return;wallet.textContent=formatNumber(data.wallet.coins);
    window.dispatchEvent(new CustomEvent('pigeon-wallet-updated',{detail:{coins:Number(data.wallet.coins),version:Number(data.wallet.version)}}));
  }
  async function request(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});
    const data=await response.json();if(!response.ok){const error=new Error(data.error||'The race request failed.');error.status=response.status;error.retryAfter=data.retryAfter;throw error;}return data;
  }
  function activeMarkup(race,remaining){
    const total=Math.max(1,Number(race.durationSeconds)||1),progress=Math.max(0,Math.min(100,(1-remaining/total)*100));
    live.style.setProperty('--race-progress',`${progress}%`);
    live.className='race-live';live.hidden=false;setup.hidden=true;
    live.innerHTML=`<p class="eyebrow">Race in progress</p><h2>${escapeHtml(race.player.nickname)} is flying to ${escapeHtml(race.route.destination.city)}</h2><p>Racing ${escapeHtml(race.opponent.nickname)} from ${escapeHtml(race.opponent.username)}. The result remains hidden until both pigeons arrive.</p><div class="race-flight-line" aria-hidden="true"><span>➤</span></div><div class="race-live-grid"><div><span>Route</span><strong>${escapeHtml(race.route.origin.city)} → ${escapeHtml(race.route.destination.city)}</strong></div><div><span>Distance</span><strong>${formatNumber(race.route.distanceKm)} km</strong></div><div><span>Expected at</span><strong>${new Date(race.finishesAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</strong></div><div><span>Time remaining</span><strong id="raceCountdown">${formatDuration(remaining)}</strong></div></div><p class="race-result-reward">Possible win: ◉ ${formatNumber(race.potentialRewards.coins)} and ${formatNumber(race.potentialRewards.xp)} XP.</p>`;
  }
  function renderActive(race){
    activeRace=race;clearInterval(countdownTimer);
    const tick=()=>{
      const remaining=Math.max(0,Math.ceil((new Date(activeRace.finishesAt).getTime()-Date.now())/1000));
      activeMarkup(activeRace,remaining);
      if(!remaining){clearInterval(countdownTimer);collectResult();}
    };
    tick();if(new Date(race.finishesAt).getTime()>Date.now())countdownTimer=setInterval(tick,1000);
  }
  function renderResult(data){
    resultShown=true;activeRace=null;clearInterval(countdownTimer);setup.hidden=true;live.hidden=false;
    live.className=`race-live ${data.won?'race-result-win':'race-result-loss'}`;
    live.innerHTML=`<p class="eyebrow">Official race result</p><h2>${data.won?'Victory!':'A brave flight'}</h2><p>${escapeHtml(data.player.nickname)} ${data.won?'arrived ahead of':'finished behind'} ${escapeHtml(data.opponent.nickname)} after ${formatNumber(data.route.distanceKm)} km.</p><div class="race-live-grid"><div><span>Your score</span><strong>${formatNumber(data.scores.player)}</strong></div><div><span>Opponent</span><strong>${formatNumber(data.scores.opponent)}</strong></div><div><span>Coins earned</span><strong>◉ ${formatNumber(data.effects.coins)}</strong></div><div><span>XP earned</span><strong>${formatNumber(data.effects.xp)} XP</strong></div></div><div class="race-live-actions"><button type="button" class="primary-button" id="raceAgain">Plan another race</button><a href="/pigeondex.html">Open PigeonDex →</a></div>`;
    document.getElementById('raceAgain').addEventListener('click',()=>{resultShown=false;live.hidden=true;setup.hidden=false;updatePreview();});
  }
  async function collectResult(){
    if(collecting||!activeRace)return;collecting=true;
    try{
      const data=await request('/api/game/races/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({raceId:activeRace.raceId})});
      updateWallet(data);window.PigeonCare?.update(data);window.PigeonUI?.update(data.pigeon);renderResult(data);
    }catch(error){
      if(error.status===429){window.setTimeout(()=>{collecting=false;collectResult();},Math.min(15000,Math.max(1000,Number(error.retryAfter||5)*1000)));return;}
      live.insertAdjacentHTML('beforeend',`<p class="race-status" data-error="true">${escapeHtml(error.message)}</p>`);
    }finally{collecting=false;}
  }
  async function refreshLobby(){
    try{const data=await request('/api/game/races');updateWallet(data);if(data.activeRace)renderActive(data.activeRace);else if(!resultShown&&data.lastRace)renderResult(data.lastRace);}
    catch(error){if(!resultShown)setStatus(error.message,true);}
  }

  if(destination.options.length>1)destination.selectedIndex=1;
  [origin,destination].forEach(select=>select.addEventListener('change',updatePreview));
  document.getElementById('raceOpponents').addEventListener('change',updatePreview);
  start.addEventListener('click',async()=>{
    const opponent=selectedOpponent();if(busy||!opponent||!routeQuote())return;
    pending||=crypto.randomUUID();try{sessionStorage.setItem(pendingKey,pending);}catch{}
    busy=true;start.disabled=true;start.textContent='Entering race…';setStatus('Registering the route and both pigeons…');
    try{
      const data=await request('/api/game/races/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending,origin:origin.value,destination:destination.value,opponentPigeonId:opponent.value})});
      try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;updateWallet(data);setStatus('Race started.');renderActive(data);
    }catch(error){if(error.status&&error.status<500){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;}setStatus(error.message,true);}
    finally{busy=false;start.textContent=`Start race · ◉ ${formatNumber(entryCost)}`;updatePreview();}
  });
  updatePreview();refreshLobby();pollTimer=setInterval(()=>{if(activeRace&&!collecting)refreshLobby();},15000);
  window.addEventListener('pagehide',()=>{clearInterval(countdownTimer);clearInterval(pollTimer);});
})();
