(() => {
  "use strict";
  const form = document.getElementById("feedForm");
  if (!form) return;
  const dialog = document.getElementById("foodDialog");
  const fields = document.getElementById("foodFields");
  const close = document.getElementById("closeFood");
  const status = document.getElementById("foodStatus");
  const recovery = document.getElementById("feedRecovery");
  const submit = document.getElementById("giveCrumbs");
  const key = `pigeon-feed:${document.querySelector("[data-pigeon-id]").dataset.pigeonId}`;
  const names = {crumbs:"Crumbs",corn:"Corn",peas:"Peas",sunflower_seeds:"Sunflower Seeds"};
  let pending;
  try {
    const saved=sessionStorage.getItem(key);
    if(saved) pending=saved.startsWith("{")?JSON.parse(saved):{requestId:saved,food:"crumbs"};
  } catch { /* In-memory retries still work when storage is disabled. */ }
  let busy = false;
  let cooldownUntil = 0;
  let timer;
  const selectedFood=()=>form.elements.food.value;
  const selectedName=()=>names[selectedFood()]||"food";
  function message(text, error = false) { status.hidden = false; status.dataset.error = String(error); status.textContent = text; }
  function clearPending() { pending = null; try { sessionStorage.removeItem(key); } catch {} }
  function countdown() {
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    submit.disabled = busy || seconds > 0;
    submit.textContent = seconds ? `Next meal in ${seconds}s` : `Give ${selectedName()} →`;
    if (!seconds) clearInterval(timer);
  }
  function openMenu(food) {
    const input=form.querySelector(`input[name="food"][value="${food||"crumbs"}"]`);
    if(input) input.checked=true;
    dialog.showModal();
    countdown();
  }
  form.addEventListener("change",event=>{
    if(event.target.name==='food') { clearPending(); countdown(); }
  });
  document.getElementById("feedOpen").addEventListener("click", () => openMenu());
  close.addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  const requested=new URLSearchParams(location.search).get("food");
  if(requested&&names[requested]) {
    openMenu(requested);
    history.replaceState(null,"",location.pathname+location.hash);
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || Date.now() < cooldownUntil || !form.reportValidity()) return;
    const food=selectedFood();
    if(!pending||pending.food!==food) pending={requestId:crypto.randomUUID(),food};
    try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch {}
    busy = true;
    fields.disabled = close.disabled = true;
    form.setAttribute("aria-busy", "true");
    recovery.hidden = true;
    message(`Sharing ${names[food]}…`);
    try {
      const response = await fetch("/api/game/feed", {
        method: "POST", credentials: "same-origin", headers: {"content-type":"application/json"},
        body: JSON.stringify({food, requestId: pending.requestId}), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400,401,403,409].includes(response.status)) clearPending();
        if (response.status === 401) { recovery.href = "/sign-in"; recovery.textContent = "Sign in again →"; recovery.hidden = false; }
        if (result.code === "NO_PIGEON" || result.code === "PROFILE_REQUIRED") { recovery.hidden = false; recovery.href = "/my-pigeon"; recovery.textContent = "Finish setting up my pigeon →"; }
        if (result.code === "FOOD_NOT_OWNED") { recovery.hidden = false; recovery.href = "/shop"; recovery.textContent = "Visit the shop →"; }
        if (response.status === 429) {
          const seconds = Number(result.retryAfter || response.headers.get("retry-after")) || 10;
          cooldownUntil = Date.now() + seconds * 1000;
          clearInterval(timer); timer = setInterval(countdown, 1000);
        }
        throw new Error(result.error || "The meal could not be confirmed. Please try again.");
      }
      window.PigeonCare.update(result);
      window.PigeonUI?.animate("feeding",result.pigeon);
      const feedback = document.getElementById("feedFeedback");
      const amount = value => Number(value).toLocaleString("en", {maximumFractionDigits:1});
      const gains=[['Hunger',result.effects.hunger],['Happiness',result.effects.happiness],['Energy',result.effects.energy],['Cleanliness',result.effects.cleanliness]]
        .filter(([,value])=>Number(value)>0).map(([label,value])=>`+${amount(value)} ${label}`);
      gains.push(`+${result.effects.xp} XP`,`+${amount(result.effects.coins)} coins`);
      feedback.textContent = result.replayed
        ? `${result.pigeon.nickname}’s meal was already saved. Rewards and inventory were counted once; your latest progress is shown.`
        : `${result.pigeon.nickname} enjoyed the ${names[result.food]||"meal"}! ${gains.join(" · ")}`;
      feedback.hidden = false;
      const choice=form.querySelector(`[data-food-choice="${result.food}"]`);
      const quantity=choice?.querySelector('[data-food-quantity]');
      if(quantity&&result.item) {
        quantity.textContent=String(result.item.quantity);
        if(Number(result.item.quantity)===0) {
          choice.querySelector('input').disabled=true;
          form.elements.food.value='crumbs';
        }
      }
      clearPending();
      status.hidden = true;
      cooldownUntil = Date.now() + Math.max(0, 10000 - (Date.now() - Date.parse(result.pigeon.last_fed_at)));
      clearInterval(timer); timer = setInterval(countdown,1000);
      dialog.close();
      feedback.scrollIntoView({block:"nearest"});
    } catch (error) {
      message(error instanceof TypeError || error.name === "TimeoutError" || error.name === "SyntaxError"
        ? "We couldn’t confirm the meal. Check your connection and try again; the same meal and inventory item will only be saved once."
        : error.message, true);
    } finally {
      busy = false;
      fields.disabled = close.disabled = false;
      form.removeAttribute("aria-busy");
      countdown();
    }
  });
})();
