const accountForm = document.querySelector("#accountForm");
const accountStatus = document.querySelector("#accountStatus");
const endpoints = { "sign-up": "/api/auth/sign-up", "sign-in": "/api/auth/sign-in", profile: "/api/auth/profile", logout: "/api/auth/sign-out" };
const destinations = new Set(["/adopt", "/my-pigeon", "/admin.html", "/complete-profile", "/sign-in?notice=signed-out"]);

accountForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const fieldset = accountForm.querySelector("fieldset");
  if (fieldset.disabled) return;
  const button = accountForm.querySelector("button");
  const originalLabel = button.textContent;
  const values = Object.fromEntries(new FormData(accountForm));
  fieldset.disabled = true;
  accountForm.setAttribute("aria-busy", "true");
  button.textContent = "One moment…";
  accountStatus.hidden = true;
  try {
    const response = await fetch(endpoints[accountForm.dataset.mode], {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify(values), signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    if (destinations.has(result.redirect)) {
      window.location.assign(result.redirect);
      return;
    }
    accountStatus.textContent = result.message || "Your account has been updated.";
    accountStatus.dataset.error = "false";
    accountStatus.hidden = false;
    const password = accountForm.querySelector("#password");
    if (password) password.value = "";
  } catch (error) {
    accountStatus.textContent = error.name === "TimeoutError" || error.name === "TypeError"
      ? "We couldn’t reach the roost. Check your connection and try again."
      : error.message;
    accountStatus.dataset.error = "true";
    accountStatus.hidden = false;
  } finally {
    fieldset.disabled = false;
    accountForm.removeAttribute("aria-busy");
    button.textContent = originalLabel;
  }
});
