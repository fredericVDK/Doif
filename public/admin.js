const tokenForm = document.querySelector("#tokenForm");
const tokenInput = document.querySelector("#tokenInput");
const leaderboardTable = document.querySelector("#leaderboardTable");
const eventList = document.querySelector("#eventList");
const adminStatus = document.querySelector("#adminStatus");
const resetButton = document.querySelector("#resetButton");
const tokenKey = "pigeon-admin-token";

tokenInput.value = localStorage.getItem(tokenKey) || "";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function adminHeaders() {
  return {
    "x-admin-token": tokenInput.value,
    "content-type": "application/json"
  };
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Admin request failed.");
  }

  return data;
}

function renderLeaderboard(entries = []) {
  leaderboardTable.innerHTML = entries.length
    ? entries.map((entry) => `
      <div class="table-row">
        <strong>${escapeHtml(entry.nickname)}</strong>
        <span>${Number(entry.feeds) || 0} feeds</span>
        <button class="delete-button" type="button" data-delete="${escapeHtml(entry.nickname)}">Delete</button>
      </div>
    `).join("")
    : '<p class="status">No leaderboard entries yet.</p>';
}

function renderEvents(events = []) {
  eventList.innerHTML = events.length
    ? events.map((event) => `
      <article class="event-card">
        <strong>${escapeHtml(event.type)}</strong>
        <span>${escapeHtml(event.createdAt)}</span>
        <code>${escapeHtml(JSON.stringify(event.details || {}))}</code>
      </article>
    `).join("")
    : '<p class="status">No events yet.</p>';
}

async function loadAdminData() {
  localStorage.setItem(tokenKey, tokenInput.value);
  adminStatus.textContent = "Loading admin data...";

  try {
    const leaderboard = await adminFetch("/api/admin/leaderboard");
    const events = await adminFetch("/api/admin/events");
    renderLeaderboard(leaderboard.leaderboard || []);
    renderEvents(events.events || []);
    adminStatus.textContent = `Loaded. Storage: ${leaderboard.storage}`;
  } catch (error) {
    adminStatus.textContent = error.message;
  }
}

tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadAdminData();
});

leaderboardTable.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");

  if (!button) return;

  await adminFetch(`/api/admin/leaderboard/${encodeURIComponent(button.dataset.delete)}`, {
    method: "DELETE"
  });
  loadAdminData();
});

resetButton.addEventListener("click", async () => {
  await adminFetch("/api/admin/reset-leaderboard", {
    method: "POST",
    body: "{}"
  });
  loadAdminData();
});

if (tokenInput.value) {
  loadAdminData();
}
