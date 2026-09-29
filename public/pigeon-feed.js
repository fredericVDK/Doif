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
  let pending;
  try { pending = sessionStorage.getItem(key); } catch { /* In-memory retries still work when storage is disabled. */ }
  let busy = false;
  let cooldownUntil = 0;
  let timer;
  function message(text, error = false) { status.hidden = false; status.dataset.error = String(error); status.textContent = text; }
  function clearPending() { pending = null; try { sessionStorage.removeItem(key); } catch {} }
  function countdown() {
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    submit.disabled = busy || seconds > 0;
    submit.textContent = seconds ? `Next crumbs in ${seconds}s` : "Give crumbs →";
    if (!seconds) clearInterval(timer);
  }
  document.getElementById("feedOpen").addEventListener("click", () => { dialog.showModal(); countdown(); });
  close.addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || Date.now() < cooldownUntil || !form.reportValidity()) return;
    pending ||= crypto.randomUUID();
    try { sessionStorage.setItem(key, pending); } catch {}
    busy = true;
    fields.disabled = close.disabled = true;
    form.setAttribute("aria-busy", "true");
    recovery.hidden = true;
    message("Sharing a few crumbs…");
    try {
      const response = await fetch("/api/game/feed", {
        method: "POST", credentials: "same-origin", headers: {"content-type":"application/json"},
        body: JSON.stringify({food: "crumbs", requestId: pending}), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400,401,403,409].includes(response.status)) clearPending();
        if (response.status === 401) { recovery.href = "/sign-in"; recovery.textContent = "Sign in again →"; recovery.hidden = false; }
        if (result.code === "NO_PIGEON" || result.code === "PROFILE_REQUIRED") { recovery.hidden = false; recovery.href = "/my-pigeon"; recovery.textContent = "Finish setting up my pigeon →"; }
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
      feedback.textContent = result.replayed
        ? `${result.pigeon.nickname}’s meal was already saved. Rewards were counted once; your latest progress is shown.`
        : `${result.pigeon.nickname} enjoyed the crumbs! +${amount(result.effects.hunger)} Hunger · +${amount(result.effects.happiness)} Happiness · +${result.effects.xp} XP · +${amount(result.effects.coins)} coins`;
      feedback.hidden = false;
      clearPending();
      status.hidden = true;
      cooldownUntil = Date.now() + Math.max(0, 10000 - (Date.now() - Date.parse(result.pigeon.last_fed_at)));
      clearInterval(timer); timer = setInterval(countdown,1000);
      dialog.close();
      feedback.scrollIntoView({block:"nearest"});
    } catch (error) {
      message(error instanceof TypeError || error.name === "TimeoutError" || error.name === "SyntaxError"
        ? "We couldn’t confirm the meal. Check your connection and try again; the same meal will only be saved once."
        : error.message, true);
    } finally {
      busy = false;
      fields.disabled = close.disabled = false;
      form.removeAttribute("aria-busy");
      countdown();
    }
  });
})();
