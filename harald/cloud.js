(function haraldCloud() {
"use strict";
const BASE="https://mcditxbuemxlaewyuwlw.supabase.co";
const KEY="sb_publishable_6JplhqTzxWN9hTcIhQkcQw_glWN8TyJ";
const SESSION_KEY="harald.auth.session.v1";
let session=null, role=null, currentUser=null, isReady=false, timer=null, running=false, retry=false, baseline=null;
let promoterIds={}, legacySnapshot=null;
const $=s=>document.querySelector(s);
function clone(x){return JSON.parse(JSON.stringify(x));}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setStatus(t,bad=false){const el=$("#cloudStatus");if(el){el.textContent=t;el.classList.toggle("cloudBad",!!bad);}}
function showGate(html){document.body.classList.add("auth-locked");let node=$("#authGate");if(!node){node=document.createElement("div");node.id="authGate";document.body.appendChild(node);}node.innerHTML=html;}
function gateForm(kind="login",message=""){
  const register=kind==="register";
  showGate(`<div class="authPanel"><div class="authBrand"><span class="authLogo">H</span><div><b>HARALD</b><small>GENIALE · SISTEMÁTICA OPERACIONAL</small></div></div><h1>${register?"Solicitar acesso":"Acessar sistemática"}</h1><p class="authDescription">${register?"Cadastre seu e-mail de trabalho. Por segurança, o acesso às lojas será liberado somente pelo administrador.":"Entre para consultar lojas, setores e roteiros protegidos."}</p>${message?`<div class="authMessage" role="status">${esc(message)}</div>`:""}<form id="haraldAuthForm"><label for="authEmail">E-mail</label><input id="authEmail" type="email" autocomplete="username" placeholder="seuemail@empresa.com" required/><label for="authPassword">Senha</label><input id="authPassword" type="password" minlength="8" autocomplete="${register?"new-password":"current-password"}" placeholder="Mínimo de 8 caracteres" required/><button class="authPrimary" type="submit">${register?"Cadastrar e solicitar liberação":"Entrar"}</button></form><button class="authLink" id="authSwitch" type="button">${register?"Já tenho cadastro · Entrar":"Primeiro acesso · Solicitar acesso"}</button><small class="authFoot">A planilha e os contatos não são disponibilizados sem autorização.</small></div>`);
  $("#authSwitch").addEventListener("click",()=>gateForm(register?"login":"register"));
  $("#haraldAuthForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const email=$("#authEmail").value.trim().toLowerCase(),password=$("#authPassword").value,btn=$("#haraldAuthForm button");
    btn.disabled=true;btn.textContent="Validando...";
    try{
      if(register){
        const x=await authRequest("/auth/v1/signup",{email,password});
        if(x.access_token){saveSession(x);await enter();}
        else gateForm("login","Cadastro enviado. Confirme o e-mail, se solicitado, e entre. Seu acesso dependerá da liberação do administrador.");
      }else{const x=await authRequest("/auth/v1/token?grant_type=password",{email,password});saveSession(x);await enter();}
    }catch(err){gateForm(register?"register":"login",String(err.message||err));}
  });
}
function pendingGate(msg){
  showGate(`<div class="authPanel"><div class="authBrand"><span class="authLogo">H</span><div><b>HARALD</b><small>GENIALE · ACESSO PROTEGIDO</small></div></div><h1>Aguardando liberação</h1><p class="authDescription">Sua conta está registrada, mas ainda não recebeu permissão para acessar a operação.</p><div class="authMessage">${esc(msg||"Solicite ao responsável pela sistemática a inclusão do seu usuário.")}</div><p class="authDescription">E-mail: <strong>${esc(currentUser?.email||"")}</strong></p><button id="authRetry" class="authPrimary" type="button">Verificar acesso novamente</button><button id="authLogoutPending" class="authLink" type="button">Sair</button></div>`);
  $("#authRetry").onclick=()=>enter();
  $("#authLogoutPending").onclick=logout;
}
function saveSession(x){session={access_token:x.access_token,refresh_token:x.refresh_token,expires_at:Date.now()+(Number(x.expires_in||3600)-30)*1000,user:x.user};sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));}
function clearSession(){session=null;sessionStorage.removeItem(SESSION_KEY);}
async function authRequest(path,payload){
  const res=await fetch(BASE+path,{method:"POST",headers:{"apikey":KEY,"content-type":"application/json"},body:JSON.stringify(payload)});
  const result=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(result.msg||result.message||result.error_description||"Não foi possível autenticar.");
  return result;
}
async function refresh(){
  if(!session?.refresh_token)throw Error("Sua sessão expirou. Entre novamente.");
  const x=await authRequest("/auth/v1/token?grant_type=refresh_token",{refresh_token:session.refresh_token});
  saveSession(x);
}
async function api(path,{method="GET",body=null,prefer=null}={}){
  if(!session)throw Error("Faça login para continuar.");
  if(Date.now()>session.expires_at)await refresh();
  const call=()=>fetch(BASE+"/rest/v1/"+path,{method,headers:{"apikey":KEY,"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json",...(prefer?{"Prefer":prefer}:{})},...(body!==null?{body:JSON.stringify(body)}:{})});
  let res=await call();if(res.status===401){await refresh();res=await call();}
  if(!res.ok){let x=await res.json().catch(()=>({}));throw Error(x.message||x.hint||`Falha ao acessar o banco (${res.status}).`);}
  if(res.status===204)return null;
  const raw=await res.text();return raw?JSON.parse(raw):null;
}
async function getAll(name,fields="*"){
  let all=[],offset=0;
  while(true){
    const rows=await api(`${name}?select=${encodeURIComponent(fields)}&limit=1000&offset=${offset}`);
    if(!Array.isArray(rows))throw Error("Resposta inesperada da base de dados.");
    all=all.concat(rows);if(rows.length<1000)break;
    offset+=rows.length;if(offset>100000)throw Error("Limite de importação excedido.");
  }
  return all;
}
async function enter(){
  showGate(`<div class="authPanel"><div class="authBrand"><span class="authLogo">H</span><div><b>HARALD</b><small>GENIALE · SISTEMÁTICA</small></div></div><h1>Conectando...</h1><p class="authDescription">Verificando seu acesso e carregando as lojas autorizadas.</p></div>`);
  try{
    const who=await fetch(BASE+"/auth/v1/user",{headers:{"apikey":KEY,"Authorization":"Bearer "+session.access_token}});
    if(who.status===401){await refresh();return enter();}
    const u=await who.json();if(!who.ok||!u.id)throw Error(u.msg||"Sua sessão não foi validada.");
    currentUser=u;
    const memberships=await api("harald_members?select=role");
    if(!memberships.length){role=null;pendingGate("Aguardando o administrador vincular sua conta à operação HARALD.");return;}
    role=memberships[0].role;
    await loadData();
  }catch(e){gateForm("login","Falha ao conectar: "+e.message);}
}
async function loadData(){
  const [sectorRows,assignmentRows,linked,persons,notes]=await Promise.all([
    getAll("harald_sectors","source_details"),
    getAll("harald_assignments","source_details"),
    getAll("harald_sector_promoters","scenario_code,sector_code,promoter_id"),
    getAll("harald_promoters","id,full_name,whatsapp,registration_number,supervisor_name,supervisor_phone,status"),
    getAll("harald_notes","target_type,target_key,scenario_code,note_body")
  ]);
  if(sectorRows.length===0||assignmentRows.length===0)throw Error("A base de lojas está vazia. Contate o administrador.");
  const map=new Map(persons.map(p=>[p.id,p])),ps={};promoterIds={};
  for(const link of linked){
    const p=map.get(link.promoter_id);if(!p)continue;
    ps[link.sector_code]={name:p.full_name||"",phone:p.whatsapp||"",badge:p.registration_number||"",supervisor:p.supervisor_name||"",supervisorPhone:p.supervisor_phone||"",situation:p.status||"Não informado"};
    promoterIds[link.sector_code]=p.id;
  }
  const cloudSaved={promoters:ps,notes:{},sectorNotes:{},promoterNotes:{},favorites:{},author:"HARALD"};
  for(const n of notes){const k=n.target_type==="store"?"notes":n.target_type==="sector"?"sectorNotes":"promoterNotes";cloudSaved[k][n.target_key]=n.note_body;}
  legacySnapshot=window.haraldApp.getSnapshot();
  cloudSaved.favorites=legacySnapshot.favorites||{};
  window.haraldApp.mount({stores:assignmentRows.map(x=>x.source_details),teams:sectorRows.map(x=>x.source_details),saved:cloudSaved});
  baseline=clone(window.haraldApp.getSnapshot());isReady=true;
  document.body.classList.remove("auth-locked");
  $("#authGate")?.remove();
  const header=$(".topTools");
  if(header&&!$("#cloudStatus")){const ui=document.createElement("div");ui.className="cloudUser";ui.innerHTML='<span id="cloudStatus" aria-live="polite">☁ Conectado</span><button type="button" id="haraldLogout" title="Encerrar sessão">Sair</button>';header.appendChild(ui);$("#haraldLogout").onclick=logout;}
  setStatus("☁ Dados sincronizados");
  if(role==="viewer"){document.body.classList.add("haraldViewer");setStatus("Somente leitura");}
  if(role!=="viewer"&&Object.keys(legacySnapshot.promoters||{}).length+Object.keys(legacySnapshot.notes||{}).length+Object.keys(legacySnapshot.sectorNotes||{}).length+Object.keys(legacySnapshot.promoterNotes||{}).length>0&&!sessionStorage.getItem("harald.migration.dismissed")){
    const ui=document.createElement("div");ui.className="legacyNotice";ui.id="legacyNotice";ui.innerHTML='<span><strong>Há contatos ou anotações antigos neste navegador.</strong> Deseja enviá-los ao banco central?</span><button type="button" id="haraldImportLocal">Migrar dados</button><button type="button" id="haraldDismissLocal">Depois</button>';
    $("#content").prepend(ui);$("#haraldImportLocal").onclick=importLocal;
    $("#haraldDismissLocal").onclick=()=>{ui.remove();sessionStorage.setItem("harald.migration.dismissed","1");};
  }
}
async function savePerson(sector,p){
  if(!p.name?.trim()&&!p.phone?.trim())return;
  const payload={full_name:p.name?.trim()||"Nome a confirmar",whatsapp:p.phone||null,registration_number:p.badge||null,supervisor_name:p.supervisor||null,supervisor_phone:p.supervisorPhone||null,status:p.situation||"pendente"};
  let id=promoterIds[sector];
  if(id){await api("harald_promoters?id=eq."+encodeURIComponent(id),{method:"PATCH",body:payload});}
  else{
    const inserted=await api("harald_promoters?select=id",{method:"POST",body:payload,prefer:"return=representation"});
    id=inserted?.[0]?.id;if(!id)throw Error("Não foi possível gerar o registro do promotor.");
    const scenario=sector.startsWith("GH1-")?"C1":"C2";
    await api("harald_sector_promoters?on_conflict=scenario_code,sector_code,promoter_id",{method:"POST",body:{scenario_code:scenario,sector_code:sector,promoter_id:id},prefer:"resolution=merge-duplicates"});
    promoterIds[sector]=id;
  }
}
async function saveNote(kind,key,value){
  const scenario=kind==="sector"?(key.startsWith("GH1-")?"C1":"C2"):null;
  const filter=`target_type=eq.${encodeURIComponent(kind)}&target_key=eq.${encodeURIComponent(key)}&scenario_code=${scenario?"eq."+scenario:"is.null"}`;
  if(!value?.trim()){await api("harald_notes?"+filter,{method:"DELETE"});return;}
  const payload={target_type:kind,target_key:key,scenario_code:scenario,note_body:value,updated_by:currentUser.id};
  await api("harald_notes?on_conflict=target_type,target_key,scenario_code",{method:"POST",body:payload,prefer:"resolution=merge-duplicates"});
}
async function flush(){
 if(running){retry=true;return;}if(!isReady||!baseline||role==="viewer")return;
 running=true;setStatus("☁ Salvando...");
 try{
   const current=window.haraldApp.getSnapshot();
   const diff={promoters:current.promoters||{},notes:current.notes||{},sectorNotes:current.sectorNotes||{},promoterNotes:current.promoterNotes||{}};
   for(const [sector,p] of Object.entries(diff.promoters)){
     if(JSON.stringify(p)!==JSON.stringify(baseline.promoters?.[sector])){await savePerson(sector,p);baseline.promoters[sector]=clone(p);}
   }
   for(const [group,kind] of [["notes","store"],["sectorNotes","sector"],["promoterNotes","promoter"]]){
     const old=baseline[group]||{},now=diff[group]||{};
     for(const key of new Set([...Object.keys(old),...Object.keys(now)])){
       if((old[key]||"")!==(now[key]||"")){await saveNote(kind,key,now[key]||"");if(now[key])old[key]=now[key];else delete old[key];}
     }
   }
   setStatus("☁ Dados sincronizados");
 }catch(e){setStatus("Falha ao salvar no banco",true);console.error("HARALD sync:",e);alert("A alteração não foi sincronizada com o Supabase. Verifique sua conexão e tente salvar novamente.\n\n"+e.message);}
 finally{running=false;if(retry){retry=false;scheduleSync();}}
}
function scheduleSync(){if(!isReady||role==="viewer")return;clearTimeout(timer);timer=setTimeout(flush,450);setStatus("☁ Alterações pendentes...");}
async function importLocal(){
  if(!legacySnapshot||!confirm("Deseja enviar os contatos e anotações antigos deste navegador para o banco central? Registros com o mesmo nome ou chave serão atualizados."))return;
  $("#haraldImportLocal").disabled=true;setStatus("☁ Migrando registros...");
  try{
    const cur=window.haraldApp.getSnapshot();
    for(const group of ["promoters","notes","sectorNotes","promoterNotes"])Object.assign(cur[group],legacySnapshot[group]||{});
    window.haraldApp.setSaved(cur);await flush();
    $("#legacyNotice")?.remove();sessionStorage.setItem("harald.migration.dismissed","1");
    setStatus("☁ Migração concluída");
  }catch(e){alert("Migração incompleta: "+e.message);$("#haraldImportLocal").disabled=false;}
}
async function logout(){
 try{if(session)await fetch(BASE+"/auth/v1/logout",{method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+session.access_token}});}catch(e){}
 clearSession();isReady=false;role=null;baseline=null;currentUser=null;
 document.body.classList.remove("haraldViewer");
 gateForm("login","Você saiu da sistemática com segurança.");
}
async function start(){
 document.body.classList.add("auth-locked");
 try{session=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");}catch(e){session=null;}
 if(session?.access_token){await enter();}else gateForm();
}
window.haraldCloud={start,scheduleSync,isReady:()=>isReady,role:()=>role};
})();
