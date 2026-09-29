const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

process.env.NODE_ENV='test';
process.env.ADMIN_TOKEN='security-test-token';
process.env.DATA_FILE=path.join(os.tmpdir(),`pigeon-security-${process.pid}.json`);
const handleRequest=require('../server');
const {requestIp,safeTokenEqual}=require('../server');

async function server() {
  const instance=http.createServer(handleRequest);
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${instance.address().port}`,close:()=>new Promise(resolve=>instance.close(resolve))};
}

test('public pages enforce a CSP and browser security headers without inline scripts',async()=>{
  const app=await server();
  try {
    const response=await fetch(`${app.url}/`),html=await response.text();
    const csp=response.headers.get('content-security-policy');
    assert.equal(response.status,200);
    assert.match(csp,/script-src 'self'/);
    assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);
    assert.match(csp,/frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    assert.match(response.headers.get('permissions-policy'),/camera=\(\)/);
    assert.doesNotMatch(html,/<script>(?:.|\n)*?<\/script>/i);
  } finally {await app.close();}
});

test('anonymous session identifiers are unguessable and JSON writes require JSON',async()=>{
  const app=await server();
  try {
    const session=await fetch(`${app.url}/api/session`),data=await session.json();
    assert.match(data.sessionId,/^ses_[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    assert.match(session.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const invalid=await fetch(`${app.url}/api/feed`,{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});
    assert.equal(invalid.status,415);
    assert.equal((await invalid.json()).error,'Please submit JSON.');
  } finally {await app.close();}
});

test('proxy addresses are trusted only when explicitly enabled',()=>{
  const request={headers:{'x-forwarded-for':'203.0.113.8, 10.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(requestIp(request,false),'127.0.0.1');
  assert.equal(requestIp(request,true),'203.0.113.8');
  request.headers['x-forwarded-for']='not-an-ip';
  assert.equal(requestIp(request,true),'127.0.0.1');
});

test('admin token comparison fails closed and handles unequal lengths',()=>{
  assert.equal(safeTokenEqual('security-test-token','security-test-token'),true);
  assert.equal(safeTokenEqual('security-test-tokee','security-test-token'),false);
  assert.equal(safeTokenEqual('short','security-test-token'),false);
  assert.equal(safeTokenEqual('', ''),false);
  assert.equal(safeTokenEqual(undefined,'security-test-token'),false);
});

test('browser assets contain no server secret and API docs render with DOM text nodes',()=>{
  const files=fs.readdirSync(path.join(__dirname,'../public')).filter(name=>/\.(?:html|js)$/i.test(name));
  const source=files.map(name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8')).join('\n');
  assert.doesNotMatch(source,/SUPABASE_SECRET_KEY|service_role|test-server-secret/);
  assert.doesNotMatch(source,/<script>(?:.|\n)*?<\/script>/i);
  const docs=fs.readFileSync(path.join(__dirname,'../public/api-docs.js'),'utf8');
  assert.match(docs,/textContent/);
  assert.doesNotMatch(docs,/innerHTML|insertAdjacentHTML/);
});

test('database game mutations are server-only and authenticated policies are read-only',()=>{
  const directory=path.join(__dirname,'../migrations');
  const sql=fs.readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>fs.readFileSync(path.join(directory,name),'utf8')).join('\n');
  const serverOnly=['adopt_game_pigeon','refresh_game_pigeon','feed_game_pigeon','play_game_pigeon','clean_game_pigeon',
    'sleep_game_pigeon','record_pigeon_discovery','acknowledge_pigeon_discovery','claim_game_daily_reward',
    'get_game_inventory','buy_game_item','record_game_daily_quest','claim_game_daily_quest',
    'sync_game_achievements','claim_game_achievement','start_crumb_game','finish_crumb_game'];
  for(const name of serverOnly) {
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION[^;]*public\\.${escaped}\\([^;]*FROM PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,'i'),name);
  }
  assert.doesNotMatch(sql,/CREATE POLICY[^;]+FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\s+TO\s+authenticated/is);
});
