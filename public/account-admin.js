(()=>{
  'use strict';
  const list=document.getElementById('accountAdminList'),status=document.getElementById('adminAccountStatus'),search=document.getElementById('accountSearch');
  if(!list)return;
  function message(text,error=false){status.textContent=text;status.dataset.error=String(error);}
  search?.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();for(const card of list.querySelectorAll('[data-account]'))card.hidden=query&&!card.dataset.account.toLowerCase().includes(query);});
  list.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-coin-form]');if(!form)return;event.preventDefault();
    const card=form.closest('[data-account]'),button=form.querySelector('button'),input=form.elements.amount,username=card.dataset.account,amount=Number(input.value);
    if(!Number.isInteger(amount)||amount<1||amount>100000){message('Choose a whole amount between 1 and 100,000.',true);return;}
    button.disabled=true;button.textContent='Adding…';message(`Adding ${amount.toLocaleString()} coins to ${username}…`);
    try{
      const response=await fetch('/api/admin/coins',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({username,amount}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Coins could not be added.');
      card.querySelector('[data-account-coins]').textContent=Number(data.coins).toLocaleString('en');
      message(`${Number(data.granted).toLocaleString()} coins added to ${data.username}. New balance: ${Number(data.coins).toLocaleString()}.`);
    }catch(error){message(error.name==='TimeoutError'||error.name==='TypeError'?'The admin service could not be reached. Please try again.':error.message,true);}
    finally{button.disabled=false;button.textContent='Add coins';}
  });
})();
