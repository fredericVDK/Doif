(() => {
  "use strict";
  function fallback(image) {
    if (image.dataset.fallback) return;
    image.dataset.fallback = "true";
    image.src = "/assets/pigeon-hero-wide.png";
    image.alt = "Pigeon illustration; breed photo unavailable";
    const caption = image.closest("figure")?.querySelector("figcaption");
    if (caption) caption.textContent = "Breed photo unavailable — illustration shown";
  }
  document.querySelectorAll("[data-pigeon-photo]").forEach(image => {
    image.addEventListener("error", () => fallback(image));
    if (image.complete && !image.naturalWidth) fallback(image);
  });
  const form = document.getElementById("adoptionForm");
  if (!form) return;
  const choosePanel = document.getElementById("choosePanel");
  const namePanel = document.getElementById("namePanel");
  const nickname = document.getElementById("nickname");
  const button = document.getElementById("adoptButton");
  const fields = document.getElementById("adoptionFields");
  const change = document.getElementById("changePigeon");
  const status = document.getElementById("adoptionStatus");
  const existing = document.getElementById("existingPigeon");
  let selected = null;
  let chosenButton = null;
  let busy = false;
  function showStep(naming) {
    choosePanel.hidden = naming;
    namePanel.hidden = !naming;
    document.getElementById("chooseStep").toggleAttribute("aria-current", !naming);
    document.getElementById("nameStep").toggleAttribute("aria-current", naming);
    document.querySelector(".adoption-steps [aria-current]").setAttribute("aria-current", "step");
  }
  document.querySelectorAll(".choose-pigeon").forEach(choice => choice.addEventListener("click", () => {
    selected = choice.dataset.id;
    chosenButton = choice;
    const card = choice.closest("article").cloneNode(true);
    card.querySelector("button").remove();
    const image = card.querySelector("img");
    image.addEventListener("error", () => fallback(image));
    document.getElementById("chosenCard").replaceChildren(card);
    status.hidden = true;
    existing.hidden = true;
    showStep(true);
    nickname.focus();
  }));
  change.addEventListener("click", () => { if (!busy) { showStep(false); chosenButton?.focus(); } });
  nickname.addEventListener("input", () => {
    nickname.setCustomValidity("");
    const value = nickname.value.trim();
    if ([...value].length > 32 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
      nickname.setCustomValidity("Use 1–32 characters without control characters.");
    }
    button.textContent = value && [...value].length <= 32 ? `Adopt ${value} →` : "Adopt my pigeon →";
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !selected) return;
    if (!nickname.value.trim()) {
      nickname.setCustomValidity("Give your pigeon a name.");
      nickname.reportValidity();
      return;
    }
    if (!form.reportValidity()) return;
    busy = true;
    fields.disabled = change.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.dataset.error = "false";
    status.textContent = "Preparing a little place in your roost…";
    existing.hidden = true;
    try {
      const response = await fetch("/api/game/adopt", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ speciesId: selected, nickname: nickname.value.trim() }),
        signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) { window.location.assign("/sign-in"); return; }
        if (result.code === "PROFILE_REQUIRED") { window.location.assign("/complete-profile"); return; }
        existing.hidden = result.code !== "ALREADY_ADOPTED";
        throw new Error(result.error || "Your pigeon could not be adopted. Please try again.");
      }
      window.location.assign("/my-pigeon");
    } catch (error) {
      status.dataset.error = "true";
      status.textContent = error.name === "TimeoutError" || error instanceof TypeError
        ? "We could not confirm your adoption. Check your connection and try again; the same adoption will only be saved once."
        : error.message;
    } finally {
      busy = false;
      fields.disabled = change.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
})();
