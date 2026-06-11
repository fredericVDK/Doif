const stage = document.querySelector(".stage");

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    <span class="body"></span>
    <span class="head"></span>
    <span class="beak"></span>
    <span class="leg one"></span>
    <span class="leg two"></span>
  `;
  stage.appendChild(pigeon);
  return pigeon;
}

function feedPigeons(event) {
  document.body.classList.add("has-fed");

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

    requestAnimationFrame(() => {
      pigeon.style.left = `${x}px`;
      pigeon.style.top = `${y + 10}px`;
    });

    window.setTimeout(() => {
      pigeon.classList.add("eating");
      crumb.classList.add("eaten");
    }, 780);

    window.setTimeout(() => {
      pigeon.classList.add("leaving");
      pigeon.style.setProperty("--face", exitFace);
      pigeon.style.left = `${exitX}px`;
    }, 1680);

    window.setTimeout(() => {
      crumb.remove();
      pigeon.remove();
    }, 2180);
  }, 1000);
}

stage.addEventListener("click", feedPigeons);
