(() => {
  "use strict";
  const button = document.getElementById("sleepButton");
  if (!button) return;
  const label = document.getElementById("sleepLabel");
  const feedback = document.getElementById("sleepFeedback");
  const recovery = document.getElementById("sleepRecovery");
  const key = `pigeon-sleep:${document.querySelector("[data-pigeon-id]").dataset.pigeonId}`;
  let pending;
  try { pending = sessionStorage.getItem(key); } catch {}
  let busy = false, cooldownUntil = 0, timer;
  function clearPending() { pending = null; try { sessionStorage.removeItem(key); } catch {} }
  function message(text, error = false) {
    feedback.textContent = text; feedback.hidden = false; feedback.dataset.error = String(error);
  }
  function countdown() {
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    button.disabled = busy || seconds > 0;
    label.textContent = busy ? "Resting…" : seconds ? `Sleep in ${seconds}s` : "Sleep";
    if (!seconds) clearInterval(timer);
  }
  button.addEventListener("click", async () => {
    if (busy || Date.now() < cooldownUntil) return;
    pending ||= crypto.randomUUID();
    try { sessionStorage.setItem(key, pending); } catch {}
    busy = true; countdown(); button.setAttribute("aria-busy", "true"); recovery.hidden = true;
    message("Settling down for a little rest…");
    try {
      const response = await fetch("/api/game/sleep", {
        method: "POST", credentials: "same-origin", headers: {"content-type":"application/json"},
        body: JSON.stringify({requestId:pending}), signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400,401,403,409].includes(response.status)) clearPending();
        if (response.status === 401) { recovery.href = "/sign-in"; recovery.textContent = "Sign in again →"; recovery.hidden = false; }
        if (["NO_PIGEON","PROFILE_REQUIRED"].includes(result.code)) { recovery.href = "/my-pigeon"; recovery.textContent = "Finish setting up my pigeon →"; recovery.hidden = false; }
        if (response.status === 429) {
          cooldownUntil = Date.now() + (Number(result.retryAfter || response.headers.get("retry-after")) || 10) * 1000;
          clearInterval(timer); timer = setInterval(countdown,1000);
        }
        throw new Error(result.error || "The rest could not be confirmed. Please try again.");
      }
      window.PigeonCare.update(result);
      window.PigeonUI?.animate("sleeping",result.pigeon);
      message(result.replayed
        ? `${result.pigeon.nickname}’s rest was already saved. Recovery was counted once; your latest stats are shown.`
        : `${result.pigeon.nickname} feels rested! +${Number(result.effects.energy).toLocaleString("en",{maximumFractionDigits:1})} Energy · +${Number(result.effects.happiness).toLocaleString("en",{maximumFractionDigits:1})} Happiness`);
      clearPending();
      cooldownUntil = Date.now() + Math.max(0, 10000 - (Date.now() - Date.parse(result.pigeon.last_slept_at)));
      clearInterval(timer); timer = setInterval(countdown,1000);
    } catch (error) {
      message(error instanceof TypeError || ["TimeoutError","SyntaxError"].includes(error.name)
        ? "We couldn’t confirm the rest. Check your connection and try again; the same rest will only be saved once."
        : error.message, true);
    } finally {
      busy = false; button.removeAttribute("aria-busy"); countdown();
    }
  });
})();
