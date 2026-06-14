const stage = document.querySelector(".stage");
const feedBoard = document.querySelector(".feed-board");
const feedCount = document.querySelector("#feedCount");
const nicknameInput = document.querySelector("#nicknameInput");
const leaderboardList = document.querySelector("#leaderboardList");

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approachDuration = 1650;
const exitDuration = 920;
const nicknameKey = "pigeon-crumbs:nickname";
const feedCountKey = "pigeon-crumbs:feed-count";
let localFeedCount = Number(localStorage.getItem(feedCountKey) || "0");

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
    renderLeaderboard(JSON.parse(localStorage.getItem("pigeon-crumbs:local-board") || "[]"));
  }
}

function updateLocalBoard(nickname) {
  const board = JSON.parse(localStorage.getItem("pigeon-crumbs:local-board") || "[]");
  const existing = board.find((entry) => entry.nickname === nickname);

  if (existing) {
    existing.feeds += 1;
  } else {
    board.push({ nickname, feeds: 1 });
  }

  board.sort((left, right) => right.feeds - left.feeds || left.nickname.localeCompare(right.nickname));
  localStorage.setItem("pigeon-crumbs:local-board", JSON.stringify(board.slice(0, 10)));
  renderLeaderboard(board.slice(0, 10));
}

async function recordFeed() {
  const nickname = cleanNickname(nicknameInput.value);
  nicknameInput.value = nickname === "Anonymous" ? "" : nickname;
  localStorage.setItem(nicknameKey, nicknameInput.value);

  localFeedCount += 1;
  localStorage.setItem(feedCountKey, String(localFeedCount));
  feedCount.textContent = String(localFeedCount);
  feedBoard.classList.add("has-score");

  try {
    const response = await fetch("/api/feed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname, amount: 1 })
    });

    if (!response.ok) throw new Error("Feed score unavailable.");

    const data = await response.json();
    renderLeaderboard(data.leaderboard || []);
  } catch (error) {
    updateLocalBoard(nickname);
  }
}

function feedPigeons(event) {
  if (event.target.closest("a, button, input, label, .feed-board")) return;

  document.body.classList.add("has-fed");
  recordFeed();

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

stage.addEventListener("click", feedPigeons);
nicknameInput.addEventListener("input", () => {
  localStorage.setItem(nicknameKey, nicknameInput.value.slice(0, 24));
});
loadLeaderboard();
