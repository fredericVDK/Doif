(() => {
  "use strict";
  const page=document.querySelector('.crumb-game-page'); if(!page) return;
  const board=document.getElementById('crumbBoard'),canvas=document.getElementById('crumbCanvas'),context=canvas.getContext('2d');
  const overlay=document.getElementById('gameOverlay'),startButton=document.getElementById('startCrumbGame');
  const instructions=document.getElementById('gameInstructions'),timeEl=document.getElementById('gameTime'),scoreEl=document.getElementById('gameScore'),status=document.getElementById('gameStatus');
  const requestKey=`crumb-game-request:${page.dataset.pigeonId}`,resultKey=`crumb-game-result:${page.dataset.pigeonId}`;
  let playing=false,birdX=50,direction=0,pointerTarget=null,lastFrame=0,startLocal=0,duration=30000,runId='',schedule=[],caught=[],frame;
  function message(text,error=false){status.textContent=text;status.dataset.error=String(error);}
  function uuid(){return crypto.randomUUID();}
  function get(key){try{return sessionStorage.getItem(key);}catch{return null;}}
  function set(key,value){try{sessionStorage.setItem(key,value);}catch{}}
  function remove(key){try{sessionStorage.removeItem(key);}catch{}}
  async function request(url,body){
    const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await response.json(); if(!response.ok) throw new Error(data.error||'The game could not be saved.'); return data;
  }
  function resetBoard(){birdX=50;scoreEl.textContent='0';timeEl.textContent='30';caught=[];draw(0);}
  function buildCrumbs(){for(const item of schedule)item.resolved=false;}
  function sizeCanvas(){const ratio=Math.min(2,devicePixelRatio||1),rect=canvas.getBoundingClientRect(),width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}return {width,height,ratio};}
  function draw(elapsed){
    const {width,height,ratio}=sizeCanvas();context.clearRect(0,0,width,height);const w=width/ratio,h=height/ratio;context.save();context.scale(ratio,ratio);
    for(const item of schedule){if(item.resolved)continue;const spawn=item.catchAtMs-1800;if(elapsed<spawn||elapsed>item.catchAtMs+120)continue;const progress=Math.max(0,Math.min(1,(elapsed-spawn)/1800)),x=Number(item.x)/100*w,y=progress*.82*h;context.save();context.translate(x,y);context.rotate(.3);context.fillStyle='#d4aa5d';context.strokeStyle='#816335';context.lineWidth=2;context.beginPath();context.ellipse(0,0,8,5.5,0,0,Math.PI*2);context.fill();context.stroke();context.fillStyle='#8e6d39';context.beginPath();context.arc(-3,-1,1.2,0,Math.PI*2);context.arc(3,1,1.2,0,Math.PI*2);context.fill();context.restore();}
    const px=birdX/100*w,py=.9*h;context.fillStyle='#f7f4e9';context.strokeStyle='#667265';context.lineWidth=2;context.beginPath();context.arc(px,py,25,0,Math.PI*2);context.fill();context.stroke();context.font='30px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText('🐦',px,py+1);context.restore();
  }
  function updateBird(delta){
    if(direction) birdX+=direction*60*delta/1000;
    else if(pointerTarget!==null){const distance=pointerTarget-birdX,step=60*delta/1000;birdX+=Math.sign(distance)*Math.min(Math.abs(distance),step);}
    birdX=Math.max(4,Math.min(96,birdX));
  }
  async function finish(){
    playing=false;cancelAnimationFrame(frame);message('Checking your catches with the server…');
    set(resultKey,JSON.stringify({runId,caught}));
    try{
      const result=await request('/api/game/crumbs/finish',{runId,caught});
      remove(requestKey);remove(resultKey);document.getElementById('gameCoins').textContent=Number(result.wallet.coins).toLocaleString('en');document.getElementById('gameXp').textContent=Number(result.pigeon.xp).toLocaleString('en');
      instructions.textContent=`You caught ${result.score} crumbs and earned ${result.effects.coins} coins plus ${result.effects.xp} XP.`;startButton.textContent='Play again';overlay.hidden=false;message('Round saved. Your reward is in your account.');
    }catch(error){instructions.textContent='Your catches are waiting to be saved.';startButton.textContent='Retry saving';overlay.hidden=false;message(error.message,true);}
  }
  function tick(now){
    if(!playing)return;const delta=Math.min(50,now-lastFrame);lastFrame=now;updateBird(delta);const elapsed=now-startLocal;
    timeEl.textContent=String(Math.max(0,Math.ceil((duration-elapsed)/1000)));
    for(const item of schedule){if(item.resolved)continue;if(elapsed>=item.catchAtMs){item.resolved=true;if(Math.abs(Number(item.x)-birdX)<=11){caught.push(Number(item.id));scoreEl.textContent=String(caught.length);}}}draw(elapsed);
    if(elapsed>=duration){finish();return;}frame=requestAnimationFrame(tick);
  }
  async function start(){
    if(playing)return;const pending=get(resultKey);if(pending){const saved=JSON.parse(pending);runId=saved.runId;caught=saved.caught;return finish();}
    startButton.disabled=true;message('Preparing a server-checked round…');
    let requestId=get(requestKey);if(!requestId){requestId=uuid();set(requestKey,requestId);}
    try{
      let data=await request('/api/game/crumbs/start',{requestId});
      if(data.completed){remove(requestKey);requestId=uuid();set(requestKey,requestId);data=await request('/api/game/crumbs/start',{requestId});}
      runId=data.runId;schedule=data.schedule.map(item=>({...item}));duration=Number(data.durationSeconds)*1000;resetBoard();buildCrumbs();
      const serverElapsed=Math.max(0,Date.parse(data.serverNow||new Date().toISOString())-Date.parse(data.startedAt));
      for(const item of schedule)if(item.catchAtMs<=serverElapsed)item.resolved=true;
      startLocal=performance.now()-serverElapsed;
      overlay.hidden=true;playing=true;lastFrame=performance.now();message('Catch those crumbs!');frame=requestAnimationFrame(tick);
    }catch(error){message(error.message,true);instructions.textContent='The round could not start yet.';overlay.hidden=false;}
    finally{startButton.disabled=false;}
  }
  function key(event,down){const value=['ArrowLeft','a','A'].includes(event.key)?-1:['ArrowRight','d','D'].includes(event.key)?1:0;if(value){event.preventDefault();direction=down?value:direction===value?0:direction;pointerTarget=null;}}
  addEventListener('keydown',event=>key(event,true));addEventListener('keyup',event=>key(event,false));
  function bind(button,value){button.addEventListener('pointerdown',event=>{event.preventDefault();direction=value;pointerTarget=null;button.setPointerCapture?.(event.pointerId);});button.addEventListener('pointerup',()=>direction=0);button.addEventListener('pointercancel',()=>direction=0);}
  bind(document.getElementById('moveLeft'),-1);bind(document.getElementById('moveRight'),1);
  board.addEventListener('pointerdown',event=>{if(!playing||event.target.closest('button'))return;const rect=board.getBoundingClientRect();pointerTarget=(event.clientX-rect.left)/rect.width*100;});
  board.addEventListener('pointermove',event=>{if(playing&&event.buttons){const rect=board.getBoundingClientRect();pointerTarget=(event.clientX-rect.left)/rect.width*100;}});
  startButton.addEventListener('click',start);
})();
