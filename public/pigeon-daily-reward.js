(() => {
  "use strict";
  const dashboard=document.querySelector("[data-pigeon-id]");
  if(!dashboard) return;

  const waitForDialogTurn=callback => {
    if(document.querySelector("dialog[open]")) return setTimeout(()=>waitForDialogTurn(callback),120);
    callback();
  };
  const request=async () => {
    const response=await fetch("/api/game/daily-reward",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(20000)
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || "Your daily reward could not be claimed. Please try again.");
    window.PigeonCare?.update(result);
    if(result.claimed) waitForDialogTurn(()=>showReward(result));
  };
  const showReward=result => {
    const dialog=document.createElement("dialog"), returnFocus=document.activeElement;
    const streak=Number(result.streak?.days)||1,cycle=Number(result.streak?.cycleDay)||1;
    const days=Array.from({length:7},(_,index)=>`<span class="streak-day ${index+1<cycle?'is-earned':''} ${index+1===cycle?'is-current':''}">Day ${index+1}${index===6?'<br>Bonus':''}</span>`).join('');
    dialog.className="daily-reward-dialog";
    dialog.setAttribute("aria-labelledby","dailyRewardTitle");
    dialog.innerHTML=`<p class="daily-reward-eyebrow">First visit today</p>
      <div class="daily-reward-icon" aria-hidden="true">🎁</div>
      <h2 id="dailyRewardTitle">Daily Reward</h2>
      <p class="daily-reward-copy">Welcome back! Your pigeon brought you today’s rewards.</p>
      <ul class="daily-reward-list">
        <li><span aria-hidden="true">🪙</span><strong>+${Number(result.effects.coins).toLocaleString("en")} Pigeon Coins</strong></li>
        <li><span aria-hidden="true">⭐</span><strong>+${Number(result.effects.xp).toLocaleString("en")} XP</strong></li>
      </ul>
      <div class="daily-streak"><strong>🔥 ${streak}-day streak</strong><span>Return each UTC day. Day 7 gives 200 coins and 50 XP.</span><div class="streak-days">${days}</div></div>
      <p class="daily-reward-reset">Next reward after 00:00 UTC.</p>
      <button type="button" class="daily-reward-continue">Continue</button>`;
    document.body.append(dialog);
    const close=()=>dialog.close();
    dialog.querySelector("button").addEventListener("click",close);
    dialog.addEventListener("cancel",event=>{event.preventDefault();close();});
    dialog.addEventListener("close",()=>{dialog.remove();returnFocus?.focus();},{once:true});
    dialog.showModal();
  };
  const showError=error => {
    let banner=document.getElementById("dailyRewardError");
    if(!banner) {
      banner=document.createElement("div"); banner.id="dailyRewardError"; banner.className="daily-reward-error";
      banner.setAttribute("role","alert");
      document.querySelector(".roost-heading")?.after(banner);
    }
    banner.replaceChildren();
    const message=document.createElement("span"); message.textContent=error.message;
    const retry=document.createElement("button"); retry.type="button"; retry.textContent="Try again";
    retry.addEventListener("click",()=>{banner.remove();request().catch(showError);},{once:true});
    banner.append(message,retry);
  };
  request().catch(showError);
})();
