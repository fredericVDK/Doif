fetch('/api/docs',{credentials:'same-origin'})
  .then(response=>{
    if(!response.ok) throw new Error('API documentation is unavailable.');
    return response.json();
  })
  .then(docs=>{
    const list=document.querySelector('#docsList');
    list.replaceChildren(...docs.endpoints.map(endpoint=>{
      const card=document.createElement('article'); card.className='endpoint-card';
      const title=document.createElement('strong'); title.textContent=`${endpoint.method} ${endpoint.path}`;
      const description=document.createElement('p'); description.textContent=endpoint.description;
      card.append(title,description);
      if(endpoint.body) {const code=document.createElement('code');code.textContent=JSON.stringify(endpoint.body);card.append(code);}
      return card;
    }));
  })
  .catch(()=>{document.querySelector('#docsList').textContent='Could not load API docs.';});
