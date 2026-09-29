(() => {
  "use strict";
  const button = document.getElementById("cleanButton");
  if (!button) return;
  const label = document.getElementById("cleanLabel");
  const feedback = document.getElementById("cleanFeedback");
  const recovery = document.getElementById("cleanRecovery");
  const key = `pigeon-clean:${document.querySelector("[data-pigeon-id]").dataset.pigeonId}`;
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
    label.textContent = busy ? "Cleaning…" : seconds ? `Clean in ${seconds}s` : "Clean";
    if (!seconds) clearInterval(timer);
  }
  button.addEventListener("click", async () => {
    if (busy || Date.now() < cooldownUntil) return;
    pending ||= crypto.randomUUID();
    try { sessionStorage.setItem(key, pending); } catch {}
    busy = true; countdown(); button.setAttribute("aria-busy", "true"); recovery.hidden = true;
    message("Freshening those feathers…");
    try {
      const response = await fetch("/api/game/clean", {
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
        throw new Error(result.error || "The wash could not be confirmed. Please try again.");
      }
      window.PigeonCare.update(result);
      window.PigeonUI?.animate("cleaning",result.pigeon);
      message(result.replayed
        ? `${result.pigeon.nickname}’s wash was already saved. Rewards were counted once; your latest progress is shown.`
        : `${result.pigeon.nickname} feels fresh and clean! +${Number(result.effects.cleanliness).toLocaleString("en",{maximumFractionDigits:1})} Cleanliness · +${Number(result.effects.happiness).toLocaleString("en",{maximumFractionDigits:1})} Happiness · +${Number(result.effects.xp).toLocaleString("en")} XP · +${Number(result.effects.coins).toLocaleString("en")} coins`);
      clearPending();
      cooldownUntil = Date.now() + Math.max(0, 10000 - (Date.now() - Date.parse(result.pigeon.last_cleaned_at)));
      clearInterval(timer); timer = setInterval(countdown,1000);
    } catch (error) {
      message(error instanceof TypeError || ["TimeoutError","SyntaxError"].includes(error.name)
        ? "We couldn’t confirm the wash. Check your connection and try again; the same wash will only be saved once."
        : error.message, true);
    } finally {
      busy = false; button.removeAttribute("aria-busy"); countdown();
    }
  });
})();
