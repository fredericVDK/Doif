const stage = document.querySelector(".stage");
const feedBoard = document.querySelector(".feed-board");
const feedCount = document.querySelector("#feedCount");
const nicknameInput = document.querySelector("#nicknameInput");
const leaderboardList = document.querySelector("#leaderboardList");
const scoreForm = document.querySelector("#scoreForm");
const submitScore = document.querySelector("#submitScore");
const heroPigeon = document.querySelector("#heroPigeon");
const jumpScare = document.querySelector("#jumpScare");

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approachDuration = 1650;
const exitDuration = 920;
const nicknameKey = "pigeon-crumbs:nickname";
let localFeedCount = 0;
let sessionId = "";
let heroPigeonPresses = 0;

nicknameInput.value = localStorage.getItem(nicknameKey) || "";
feedCount.textContent = String(localFeedCount);

function makeCrumb(x, y) {
  const crumb = document.createElement("span");
  crumb.className = "crumb";
  crumb.style.left = `${x}px`;
  crumb.style.top = `${y}px`;
  crumb.style.setProperty("--spin", `${rand(-36, 36)}deg`);
  stage.appendChild(crumb);
  return crumb;
}

function makePigeon(startX, startY, targetX, targetY) {
  const pigeon = document.createElement("span");
  pigeon.className = "tiny-pigeon";
  pigeon.style.left = `${startX}px`;
  pigeon.style.top = `${startY}px`;
  pigeon.style.setProperty("--face", startX > targetX ? "-1" : "1");
  pigeon.innerHTML = `
    <span class="shadow"></span>
    <span class="tail"></span>
    <span class="body"></span>
    <span class="wing"></span>
    <span class="neck"></span>
    <span class="head"></span>
    <span class="eye"></span>
    <span class="beak"></span>
    <span class="leg one"></span>
    <span class="leg two"></span>
    <span class="toe one"></span>
    <span class="toe two"></span>
  `;
  stage.appendChild(pigeon);
  return pigeon;
}

function makeWanderPath(startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy) || 1;
  const perpX = -dy / distance;
  const perpY = dx / distance;
  const drift = Math.random() > 0.5 ? 1 : -1;
  const wobbleOne = rand(18, 58) * drift;
  const wobbleTwo = rand(14, 48) * -drift;
  const minX = 26;
  const maxX = window.innerWidth - 26;
  const minY = 26;
  const maxY = window.innerHeight - 26;

  return [
    { x: startX, y: startY },
    {
      x: clamp(startX + dx * 0.32 + perpX * wobbleOne, minX, maxX),
      y: clamp(startY + dy * 0.32 + perpY * wobbleOne + rand(-18, 18), minY, maxY)
    },
    {
      x: clamp(startX + dx * 0.68 + perpX * wobbleTwo, minX, maxX),
      y: clamp(startY + dy * 0.68 + perpY * wobbleTwo + rand(-14, 18), minY, maxY)
    },
    { x: endX, y: endY }
  ];
}

function movePigeon(pigeon, path, duration) {
  const animation = pigeon.animate(
    path.map((point, index) => ({
      left: `${point.x}px`,
      top: `${point.y}px`,
      offset: index / (path.length - 1)
    })),
    {
      duration,
      easing: "cubic-bezier(0.34, 0.02, 0.18, 1)",
      fill: "forwards"
    }
  );
  const destination = path[path.length - 1];

  animation.finished.then(() => {
    pigeon.style.left = `${destination.x}px`;
    pigeon.style.top = `${destination.y}px`;
  });

  return animation;
}

function cleanNickname(value) {
  return String(value || "")
    .replace(/[^\w .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24) || "Anonymous";
}

function renderLeaderboard(entries = []) {
  leaderboardList.innerHTML = entries.length
    ? entries.map((entry) => `
      <li>
        <span>${escapeHtml(entry.nickname)}</span>
        <strong>${Number(entry.feeds) || 0}</strong>
      </li>
    `).join("")
    : "<li>No feeders yet.</li>";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard");

    if (!response.ok) throw new Error("Leaderboard unavailable.");

    const data = await response.json();
    renderLeaderboard(data.leaderboard || []);
  } catch (error) {
    leaderboardList.innerHTML = "<li>Leaderboard unavailable.</li>";
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/session");

    if (!response.ok) return;

    const data = await response.json();
    sessionId = data.sessionId || "";
  } catch (error) {
    sessionId = "";
  }
}

function trackEvent(type, details = {}) {
  const payload = JSON.stringify({
    type,
    details: {
      ...details,
      sessionId
    }
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function updateLocalBoard(nickname, amount) {
  const board = JSON.parse(localStorage.getItem("pigeon-crumbs:local-board") || "[]");
  const existing = board.find((entry) => entry.nickname === nickname);

  if (existing) {
    existing.feeds += amount;
  } else {
    board.push({ nickname, feeds: amount });
  }

  board.sort((left, right) => right.feeds - left.feeds || left.nickname.localeCompare(right.nickname));
  localStorage.setItem("pigeon-crumbs:local-board", JSON.stringify(board.slice(0, 10)));
  renderLeaderboard(board.slice(0, 10));
}

function countFeed() {
  localFeedCount += 1;
  feedCount.textContent = String(localFeedCount);
  feedBoard.classList.add("has-score");
}

async function submitCurrentScore(event) {
  event.preventDefault();

  if (!localFeedCount) {
    nicknameInput.focus();
    return;
  }

  const nickname = cleanNickname(nicknameInput.value);
  nicknameInput.value = nickname === "Anonymous" ? "" : nickname;
  localStorage.setItem(nicknameKey, nicknameInput.value);

  submitScore.disabled = true;

  try {
    const response = await fetch("/api/feed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname, amount: localFeedCount })
    });

    if (!response.ok) throw new Error("Feed score unavailable.");

    const data = await response.json();
    renderLeaderboard(data.leaderboard || []);
    trackEvent("score_submitted", {
      nickname,
      amount: localFeedCount
    });
  } catch (error) {
    leaderboardList.insertAdjacentHTML("afterbegin", "<li>Could not submit score. Try again.</li>");
  } finally {
    localFeedCount = 0;
    feedCount.textContent = "0";
    submitScore.disabled = false;
  }
}

function feedPigeons(event) {
  if (event.target.closest("a, button, input, label, .feed-board")) return;

  document.body.classList.add("has-fed");
  countFeed();

  if (localFeedCount === 1 || localFeedCount % 25 === 0) {
    trackEvent("crumb_fed", { count: localFeedCount });
  }

  const x = event.clientX;
  const y = event.clientY;
  const crumb = makeCrumb(x, y);

  window.setTimeout(() => {
    const sideOffset = Math.max(86, Math.min(160, window.innerWidth * 0.18));
    const startsLeft = Math.random() > 0.5;
    const startX = startsLeft ? x - sideOffset : x + sideOffset;
    const exitX = startsLeft ? x + sideOffset * 0.85 : x - sideOffset * 0.85;
    const exitFace = startsLeft ? "1" : "-1";
    const startY = clamp(y + rand(-70, 90), 34, window.innerHeight - 34);

    const pigeon = makePigeon(startX, startY, x, y + 8);
    const crumbX = x;
    const crumbY = y + 10;
    const approachPath = makeWanderPath(startX, startY, crumbX, crumbY);

    movePigeon(pigeon, approachPath, approachDuration);

    window.setTimeout(() => {
      pigeon.classList.add("eating");
      crumb.classList.add("eaten");
    }, approachDuration);

    window.setTimeout(() => {
      pigeon.classList.add("leaving");
      pigeon.style.setProperty("--face", exitFace);
      movePigeon(
        pigeon,
        makeWanderPath(crumbX, crumbY, exitX, clamp(crumbY + rand(-34, 34), 26, window.innerHeight - 26)),
        exitDuration
      );
    }, approachDuration + 820);

    window.setTimeout(() => {
      crumb.remove();
      pigeon.remove();
    }, approachDuration + 820 + exitDuration + 260);
  }, 1000);
}

function triggerJumpScare() {
  jumpScare.classList.add("is-visible");
  jumpScare.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    jumpScare.classList.remove("is-visible");
    jumpScare.setAttribute("aria-hidden", "true");
  }, 1000);
}

function countHeroPigeonPress(event) {
  event.stopPropagation();
  heroPigeonPresses += 1;

  if (heroPigeonPresses % 25 === 0) {
    triggerJumpScare();
  }
}

stage.addEventListener("click", feedPigeons);
heroPigeon.addEventListener("click", countHeroPigeonPress);
heroPigeon.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    countHeroPigeonPress(event);
  }
});
scoreForm.addEventListener("submit", submitCurrentScore);
nicknameInput.addEventListener("input", () => {
  localStorage.setItem(nicknameKey, nicknameInput.value.slice(0, 24));
});
loadLeaderboard();
loadSession();
