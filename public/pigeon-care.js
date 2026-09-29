(() => {
  "use strict";
  const dashboard = document.querySelector("[data-pigeon-id]");
  if (!dashboard) return;
  let version = Number(dashboard.dataset.pigeonVersion);
  let level = Number(dashboard.dataset.pigeonLevel);
  let stage = dashboard.dataset.pigeonStage;
  let coinsVersion = Number(dashboard.dataset.coinsVersion ?? 0);
  window.PigeonCare = {
    update(result) {
      // Coins have their own revision: an older care response may carry a newer balance.
      if (result.wallet && Number(result.wallet.version) >= coinsVersion) {
        coinsVersion = Number(result.wallet.version);
        document.getElementById("coinsValue").textContent = Number(result.wallet.coins).toLocaleString("en");
      }
      // Feed and Play can finish out of order; never repaint an older saved state.
      if (!result.pigeon || Number(result.pigeon.version) < version) return;
      version = Number(result.pigeon.version);
      const playFeedback = document.getElementById("playFeedback");
      if (playFeedback?.dataset.code === "TOO_TIRED" && Number(result.pigeon.energy) >= 10) playFeedback.hidden = true;
      document.getElementById("pigeonStats").innerHTML = result.statsHtml;
      document.getElementById("xpValue").textContent = Number(result.pigeon.xp).toLocaleString("en");
      document.getElementById("levelValue").textContent = Number(result.pigeon.level).toLocaleString("en");
      document.getElementById("xpProgress").innerHTML = result.xpHtml;
      document.getElementById("growthStage").innerHTML = result.growthHtml;
      if (Number(result.pigeon.level) > level) {
        const feedback = document.getElementById("levelFeedback");
        feedback.textContent = `${result.pigeon.nickname} reached Level ${Number(result.pigeon.level).toLocaleString("en")}!${result.pigeon.growth_stage !== stage && result.growthLabel ? ` Growth stage: ${result.growthLabel}.` : ""}`;
        feedback.hidden = false;
        window.PigeonUI?.levelUp();
      }
      level = Number(result.pigeon.level);
      stage = result.pigeon.growth_stage;
      const saved = new Date(result.pigeon.last_updated);
      document.getElementById("savedStatus").textContent = `Last saved ${saved.toLocaleString("en-GB", {timeZone:"UTC"})} UTC. Your pigeon’s progress is saved to your account.`;
      window.PigeonUI?.update(result.pigeon);
      window.PigeonDailyQuests?.refresh();
      window.PigeonAchievements?.refresh();
    }
  };
})();
