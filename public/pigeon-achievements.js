(() => {
  "use strict";
  const root=document.getElementById("achievements");
  if(!root) return;
  const list=document.getElementById("achievementList");
  const summary=document.getElementById("achievementSummary");
  const status=document.getElementById("achievementStatus");
  const icons={first_crumb:"🍞",pigeon_parent:"🏠",bird_nerd:"🔎",best_friends:"♥",collector:"🎒"};
  let busy=false;
  function card(item) {
    const article=document.createElement("article");
    article.className=`achievement-card${item.claimed?' achievement-claimed':item.unlocked?' achievement-unlocked':''}`;
    article.dataset.achievementId=item.id;
    const icon=document.createElement("span"); icon.className="achievement-icon"; icon.ariaHidden="true"; icon.textContent=icons[item.id]||"★";
    const copy=document.createElement("div"); copy.className="achievement-copy";
    const title=document.createElement("h3"); title.textContent=item.title;
    const description=document.createElement("p"); description.textContent=item.description;
    const progress=document.createElement("p"); progress.className="achievement-progress";
    const amount=document.createElement("strong"); amount.textContent=`${Number(item.progress)} / ${Number(item.goal)}`;
    progress.append(amount,` · ◉ ${Number(item.reward.coins)} · ${Number(item.reward.xp)} XP`); copy.append(title,description,progress);
    const button=document.createElement("button"); button.type="button"; button.className="achievement-claim"; button.dataset.achievementClaim=item.id;
    button.disabled=!item.unlocked||item.claimed; button.textContent=item.claimed?'Claimed':item.unlocked?'Claim reward':'Locked';
    article.append(icon,copy,button); return article;
  }
  function render(data) {
    list.replaceChildren(...data.achievements.map(card));
    summary.textContent=`${Number(data.unlockedCount)} / ${Number(data.total)} unlocked`;
  }
  function message(text,error=false) {status.hidden=false;status.dataset.error=String(error);status.textContent=text;}
  async function request(url,options) {
    const response=await fetch(url,{credentials:"same-origin",signal:AbortSignal.timeout(15000),...options});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||"Achievements could not be updated.");
    return data;
  }
  async function refresh() {
    try {render(await request("/api/game/achievements"));}
    catch {message("Achievement progress is temporarily unavailable.",true);}
  }
  list.addEventListener("click",async event=>{
    const button=event.target.closest("[data-achievement-claim]");
    if(!button||busy||button.disabled) return;
    busy=true; button.disabled=true; button.textContent="Claiming…"; status.hidden=true;
    try {
      const result=await request("/api/game/achievements/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({achievementId:button.dataset.achievementClaim})});
      render(result.achievements); window.PigeonCare?.update(result);
      message(`Achievement reward claimed: +${Number(result.effects.coins)} coins and +${Number(result.effects.xp)} XP.`);
    } catch(error) {message(error.message,true);await refresh();}
    finally {busy=false;}
  });
  window.PigeonAchievements={refresh};
})();
