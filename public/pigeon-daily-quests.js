(() => {
  "use strict";
  const root=document.getElementById("dailyQuests");
  if(!root) return;
  const list=document.getElementById("dailyQuestList");
  const status=document.getElementById("dailyQuestStatus");
  let busy=false;
  function card(quest) {
    const article=document.createElement("article");
    article.className=`quest-card${quest.claimed?' quest-claimed':quest.completed?' quest-complete':''}`;
    article.dataset.questId=quest.id;
    const copy=document.createElement("div"); copy.className="quest-copy";
    const check=document.createElement("span"); check.className="quest-check"; check.ariaHidden="true"; check.textContent=quest.completed?'✓':'○';
    const details=document.createElement("div");
    const title=document.createElement("h3"); title.textContent=quest.title;
    const progress=document.createElement("p");
    const amount=document.createElement("strong"); amount.dataset.questProgress=""; amount.textContent=`${Number(quest.progress)} / ${Number(quest.goal)}`;
    const reward=document.createElement("span"); reward.setAttribute("aria-label",`Reward ${Number(quest.reward.coins)} coins and ${Number(quest.reward.xp)} XP`); reward.textContent=`◉ ${Number(quest.reward.coins)} · ${Number(quest.reward.xp)} XP`;
    progress.append(amount," · ",reward); details.append(title,progress); copy.append(check,details);
    const button=document.createElement("button"); button.type="button"; button.className="quest-claim"; button.dataset.questClaim=quest.id;
    button.disabled=!quest.completed||quest.claimed; button.textContent=quest.claimed?'Claimed':quest.completed?'Claim reward':'In progress';
    article.append(copy,button); return article;
  }
  function render(data) {
    list.replaceChildren(...data.quests.map(card));
    root.dataset.resetAt=data.resetAt||"";
  }
  function message(text,error=false) {status.hidden=false;status.dataset.error=String(error);status.textContent=text;}
  async function request(url,options) {
    const response=await fetch(url,{credentials:"same-origin",signal:AbortSignal.timeout(15000),...options});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||"Daily quests could not be updated.");
    return data;
  }
  async function refresh() {
    try {render(await request("/api/game/quests"));}
    catch {message("Daily quest progress is temporarily unavailable.",true);}
  }
  list.addEventListener("click",async event=>{
    const button=event.target.closest("[data-quest-claim]");
    if(!button||busy||button.disabled) return;
    busy=true; button.disabled=true; button.textContent="Claiming…"; status.hidden=true;
    try {
      const result=await request("/api/game/quests/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({questId:button.dataset.questClaim})});
      render(result.dailyQuests);
      window.PigeonCare?.update(result);
      message(`Reward claimed: +${Number(result.effects.coins)} coins and +${Number(result.effects.xp)} XP.`);
    } catch(error) {message(error.message,true);await refresh();}
    finally {busy=false;}
  });
  window.PigeonDailyQuests={refresh};
})();
