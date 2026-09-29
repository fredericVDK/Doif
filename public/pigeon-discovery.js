(() => {
  "use strict";
  const escaped = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const safeUrl = value => {try {const url=new URL(value,location.origin); return ["http:","https:"].includes(url.protocol) ? url.href : "";} catch {return "";}};
  const displayed=new Set();
  const queue=[];
  let active=false;
  async function request(url,body) {
    const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(20000),
      ...(body ? {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)} : {})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || "Your PigeonDex could not be saved. Please try again.");
    return result;
  }
  function next() {
    if(active || !queue.length) return;
    if(document.querySelector("dialog[open]")) {setTimeout(next,120);return;}
    active=true;
    const bird=queue.shift(), dialog=document.createElement("dialog");
    const returnFocus=document.activeElement;
    dialog.className="discovery-dialog";
    dialog.setAttribute("aria-labelledby","discoveryTitle");
    const credit=bird.imageAttribution || {};
    dialog.innerHTML=`<p class="discovery-eyebrow">New pigeon discovered</p>
      <img src="${escaped(safeUrl(bird.image) || "/assets/pigeon-hero-wide.png")}" alt="${escaped(bird.name)}" width="460" height="280">
      <p class="discovery-credit"><a href="${escaped(safeUrl(credit.url || bird.sourceUrl))}" target="_blank" rel="noreferrer">${escaped([credit.author,credit.source,credit.license].filter(Boolean).join(" · ") || "Photo source")}</a>${credit.licenseUrl ? ` · <a href="${escaped(safeUrl(credit.licenseUrl))}" target="_blank" rel="noreferrer">License</a>` : ""}</p>
      <h2 id="discoveryTitle">${escaped(bird.name)}</h2>
      <p><i>${escaped(bird.scientificName || bird.parentScientificName)}</i> · ${bird.kind==="breed" ? "Domestic breed" : "Wild species"}</p>
      <p>Game rarity: ${escaped(bird.gameRarity)}</p>
      <p class="discovery-error" role="status" hidden></p>
      <div class="discovery-actions"><a href="/pigeondex.html?breed=${encodeURIComponent(bird.id)}">View in PigeonDex</a><button type="button">Continue</button><button type="button" class="discovery-later" hidden>Close for now</button></div>`;
    document.body.append(dialog);
    dialog.querySelector("img").addEventListener("error",event=>{event.target.src="/assets/pigeon-hero-wide.png";},{once:true});
    const controls=dialog.querySelector(".discovery-actions");
    let busy=false;
    async function done(destination) {
      if(busy) return;
      busy=true;
      try {
        await request("/api/game/discoveries/seen",{speciesId:bird.id});
        dialog.close();
        if(destination) location.assign(destination);
      } catch(error) {
        const status=dialog.querySelector(".discovery-error");
        status.textContent=error.message; status.hidden=false;
        dialog.querySelector(".discovery-later").hidden=false;
      } finally {busy=false;}
    }
    controls.querySelector("a").addEventListener("click",event=>{event.preventDefault();done(event.currentTarget.href);});
    controls.querySelector("button").addEventListener("click",()=>done());
    dialog.querySelector(".discovery-later").addEventListener("click",()=>dialog.close());
    dialog.addEventListener("cancel",event=>{event.preventDefault();done();});
    dialog.addEventListener("close",()=>{dialog.remove();active=false;returnFocus?.focus();next();},{once:true});
    dialog.showModal();
  }
  function showPending(birds) {
    for(const bird of birds || []) if(!displayed.has(bird.id)) {displayed.add(bird.id);queue.push(bird);}
    next();
  }
  window.PigeonDiscovery={request,showPending};
  if(document.querySelector("[data-pigeon-id]")) {
    request("/api/game/discoveries").then(data=>showPending(data.pending)).catch(()=>{
      // Care remains usable if the catalogue is temporarily unavailable.
      const note=document.createElement("p");
      note.className="stats-help"; note.textContent="Your discoveries are temporarily unavailable. Open PigeonDex to try again.";
      document.querySelector(".roost-heading").append(note);
    });
  }
})();
