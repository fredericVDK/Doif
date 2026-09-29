function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderAuthPage(mode, { configured = true, user, profile, notice, message } = {}) {
  const {renderNavigation}=require('../navigation');
  const headings = {
    "sign-up": ["A little home for your pigeon.", "Create your account and start your pigeon’s story."],
    "sign-in": ["Welcome back, pigeon friend.", "Sign in to return to your roost."],
    profile: ["What should we call you?", "Choose a username to finish setting up your account."],
    logout: ["Leaving the roost?", "Sign out of this browser. Your account will be here when you return."],
    adopt: ["Your roost is ready.", "Your account is set up. Starter pigeon adoption is coming soon."],
    home: ["Welcome home.", "Your account is ready for a feathered friend. Pigeon care is coming soon."],
    error: ["A small pause at the roost.", message || "Please try again in a moment."]
  };
  const [title, description] = headings[mode];
  const signup = mode === "sign-up";
  const credentials = signup || mode === "sign-in";
  const hasForm = credentials || mode === "profile" || mode === "logout";
  let status = !configured ? "Accounts are not available yet. You can still explore PigeonDex and feed the pigeons." : "";
  if (notice === "confirmation-failed") status = "That confirmation link could not be completed. Open the latest link in the browser where you registered, or try signing in if your email is already confirmed.";
  if (notice === "signed-out") status = "You’re signed out. See you at the roost!";
  const form = hasForm ? `
    <form id="accountForm" data-mode="${mode}">
      <fieldset ${configured ? "" : "disabled"}>
        <legend class="sr-only">${escapeHtml(title)}</legend>
        ${signup || mode === "profile" ? `<label for="username">Username</label>
        <input id="username" name="username" autocomplete="nickname" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" aria-describedby="usernameHelp" placeholder="PigeonFriend">
        <small id="usernameHelp">3–24 letters, numbers or underscores.</small>` : ""}
        ${credentials ? `<label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="${signup ? 12 : 1}" maxlength="128" ${signup ? 'aria-describedby="passwordHelp"' : ""}>
        ${signup ? '<small id="passwordHelp">Use at least 12 characters. A few memorable words work well.</small>' : ""}` : ""}
        <button class="primary-button" type="submit">${signup ? "Create my account" : mode === "sign-in" ? "Sign in" : mode === "profile" ? "Save my username" : "Sign out"}<span aria-hidden="true"> →</span></button>
      </fieldset>
    </form>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} · Pigeon Crumbs</title>
  <link rel="stylesheet" href="/auth.css">
  <link rel="stylesheet" href="/site-navigation.css">
  <script src="/auth.js" defer></script>
</head>
<body>
  <header class="account-header">
    <a class="brand" href="/">Pigeon Crumbs<span>A little kindness goes a long way.</span></a>
    ${renderNavigation(undefined,{signedIn:Boolean(user)})}
  </header>
  <main class="account-shell">
    <aside class="pigeon-welcome" aria-label="Your neighbourhood pigeon">
      <span class="eyebrow">Small bird. Big personality.</span>
      <img src="/assets/pigeon-hero-wide.png" alt="A grey pigeon waiting on the pavement" width="780" height="520">
      <div class="welcome-caption"><span class="crumb-dots" aria-hidden="true">• • •</span><h2>Every pigeon deserves<br>a place to call home.</h2><p>Meet the birds who share our streets.<br>Leave a crumb. Make a friend.</p></div>
    </aside>
    <section class="account-card" aria-labelledby="accountTitle">
      <p class="eyebrow">${signup ? "Join the flock" : mode === "sign-in" ? "Back to the roost" : "Your Pigeon Crumbs account"}</p>
      <h1 id="accountTitle">${escapeHtml(title)}</h1>
      <p class="intro">${escapeHtml(description)}</p>
      ${profile && ["home", "adopt"].includes(mode) ? `<div class="profile-summary"><span>Signed in as</span><strong>${escapeHtml(profile.username)}</strong><small>${escapeHtml(user.email)}</small></div>` : ""}
      <p id="accountStatus" role="status" aria-live="polite" ${status ? "" : "hidden"}>${escapeHtml(status)}</p>
      ${form}
      ${credentials ? `<p class="account-alternative">${signup ? 'Already part of the flock? <a href="/sign-in">Sign in</a>' : 'New to the neighbourhood? <a href="/sign-up">Create an account</a>'}</p>` : ""}
      ${["home", "adopt"].includes(mode) ? '<div class="account-links"><a class="primary-button" href="/pigeondex.html">Explore PigeonDex →</a><a href="/logout">Sign out</a></div>' : ""}
      ${mode === "profile" || mode === "logout" ? '<p class="account-alternative"><a href="/my-pigeon">Back to my account</a></p>' : ""}
      ${mode === "error" ? '<a class="primary-button" href="/sign-in">Back to sign in</a>' : ""}
      <noscript><p>Enable JavaScript to use the account forms. Public pages remain available.</p></noscript>
      <a class="back-link" href="/">← Back to the pavement</a>
    </section>
  </main>
  <footer class="account-footer">Be kind to the birds we forgot.</footer>
</body>
</html>`;
}

module.exports = { renderAuthPage, escapeHtml };
