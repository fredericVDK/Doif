(() => {
  "use strict";
  const page=document.querySelector("[data-shop-balance]");
  if(!page) return;
  const buttons=[...document.querySelectorAll(".shop-buy")], status=document.getElementById("shopStatus");
  const storageKey="pigeon-shop-purchase";
  let balance=Number(page.dataset.shopBalance), busy=false, pending;
  try {pending=JSON.parse(sessionStorage.getItem(storageKey)||"null");} catch {pending=null;}
  const savePending=value=>{pending=value;try {value?sessionStorage.setItem(storageKey,JSON.stringify(value)):sessionStorage.removeItem(storageKey);} catch {}};
  const show=(message,error=false)=>{status.textContent=message;status.dataset.error=String(error);status.hidden=false;status.scrollIntoView({block:"nearest"});};
  const refreshButtons=()=>buttons.forEach(button=>{button.disabled=busy || Number(button.closest("[data-price]").dataset.price)>balance;button.dataset.busy=String(busy);});
  buttons.forEach(button=>button.addEventListener("click",async()=>{
    if(busy || button.disabled) return;
    const itemId=button.dataset.itemId;
    if(!pending || pending.itemId!==itemId) savePending({itemId,requestId:crypto.randomUUID()});
    busy=true;refreshButtons();show(`Adding ${button.textContent.replace(/^Buy /,"")} to your inventory…`);
    try {
      const response=await fetch("/api/game/shop/buy",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
        body:JSON.stringify(pending),signal:AbortSignal.timeout(25000)});
      const result=await response.json();
      if(!response.ok) {
        if([400,401,403,409].includes(response.status)) savePending(null);
        throw new Error(result.error||"Your purchase could not be confirmed. Please try again.");
      }
      balance=Number(result.wallet.coins);page.dataset.shopBalance=String(balance);
      document.getElementById("shopCoins").textContent=balance.toLocaleString("en");
      const card=document.querySelector(`[data-shop-item="${CSS.escape(result.item.id)}"]`);
      card?.querySelector("[data-owned]")?.replaceChildren(Number(result.item.quantity).toLocaleString("en"));
      show(result.replayed?`${result.item.name} was already purchased. You were charged only once.`:`${result.item.name} was added to your inventory!`);
      savePending(null);
    } catch(error) {
      show(error instanceof TypeError || error.name==="TimeoutError" || error.name==="SyntaxError"
        ? "We couldn’t confirm the purchase. Check your connection and try the same item again; it will only be charged once."
        : error.message,true);
    } finally {busy=false;refreshButtons();}
  }));
  refreshButtons();
  window.addEventListener('pigeon-wallet-updated',event=>{balance=Number(event.detail.coins);page.dataset.shopBalance=String(balance);document.getElementById('shopCoins').textContent=balance.toLocaleString('en');refreshButtons();});
})();
