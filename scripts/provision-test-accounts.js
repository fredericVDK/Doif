const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');

function localEnv(){
  const file=path.join(__dirname,'..','.env');
  if(!fs.existsSync(file))return{};
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(!match)return[];
    const value=match[2].replace(/^(['"])(.*)\1$/,'$2');
    return[[match[1],value]];
  }));
}

const env={...localEnv(),...process.env};
const password=env.TEST_ACCOUNT_PASSWORD;
if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!password||password.length<8){
  throw new Error('Set SUPABASE_URL, SUPABASE_SECRET_KEY and TEST_ACCOUNT_PASSWORD before provisioning test accounts.');
}
const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const accounts=[
  {username:'RaceTester1',nickname:'Sprint',level:3},
  {username:'RaceTester2',nickname:'Compass',level:8},
  {username:'RaceTester3',nickname:'Marathon',level:15},
  {username:'supertest',nickname:'Super Pigeon',level:20,coins:1000000000}
];
const emailFor=username=>`u-${createHash('sha256').update(username.toLowerCase(),'utf8').digest('hex')}@accounts.pigeoncrumbs.invalid`;
const fail=(action,error)=>{throw new Error(`${action}: ${error.message} (${error.code||error.status||'unknown'})`);};

async function profile(username){
  const {data,error}=await admin.rpc('find_game_user_by_username',{p_username:username});
  if(error)fail(`Find ${username}`,error);
  return Array.isArray(data)?data[0]||null:data||null;
}

async function provision(definition,index,starters){
  let saved=await profile(definition.username),id=saved?.id,created=false;
  if(!id){
    const result=await admin.auth.admin.createUser({email:emailFor(definition.username),password,email_confirm:true,user_metadata:{username:definition.username}});
    if(result.error)fail(`Create ${definition.username}`,result.error);
    id=result.data.user.id;created=true;
    const inserted=await admin.from('game_users').insert({id,username:definition.username,coins:definition.coins||1000});
    if(inserted.error)fail(`Create profile ${definition.username}`,inserted.error);
  }else{
    const updated=await admin.auth.admin.updateUserById(id,{password,email_confirm:true,user_metadata:{username:definition.username}});
    if(updated.error)fail(`Update ${definition.username}`,updated.error);
  }
  const starter=starters[index%starters.length];
  const adopted=await admin.rpc('adopt_game_pigeon',{p_user_id:id,p_species_id:starter.id,p_nickname:definition.nickname});
  if(adopted.error)fail(`Adopt for ${definition.username}`,adopted.error);
  const userUpdate=await admin.from('game_users').update({coins:definition.coins||1000}).eq('id',id);
  if(userUpdate.error)fail(`Fund ${definition.username}`,userUpdate.error);
  const pigeonUpdate=await admin.from('game_pigeons').update({level:definition.level,energy:100,health:100}).eq('user_id',id);
  if(pigeonUpdate.error)fail(`Level ${definition.username}`,pigeonUpdate.error);
  return{username:definition.username,created,level:definition.level};
}

(async()=>{
  const {data:starters,error}=await admin.from('game_species').select('id').eq('is_starter',true).order('id').limit(3);
  if(error)fail('Load starter pigeons',error);
  if(!starters?.length)throw new Error('No starter pigeons are installed.');
  const results=[];
  for(let index=0;index<accounts.length;index++)results.push(await provision(accounts[index],index,starters));
  for(const result of results)console.log(`${result.username}: ${result.created?'created':'updated'}, level ${result.level}`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
