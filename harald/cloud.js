(function haraldCloud() {
"use strict";
const BASE="https://mcditxbuemxlaewyuwlw.supabase.co";
const KEY="sb_publishable_6JplhqTzxWN9hTcIhQkcQw_glWN8TyJ";
const SESSION_KEY="harald.auth.session.v1";
let session=null, role=null, currentUser=null, isReady=false, timer=null, running=false, retry=false, baseline=null;
let promoterIds={}, promoterNames={}, personKeyToId={}, legacySnapshot=null;
let networkWatchTimer=null, lastNetworkRunId=0, networkWatchBusy=false;
const $=s=>document.querySelector(s);
function clone(x){return JSON.parse(JSON.stringify(x));}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setStatus(t,bad=false){const el=$("#cloudStatus");if(el){el.textContent=t;el.classList.toggle("cloudBad",!!bad);}}
function showGate(html){document.body.classList.add("auth-locked");let node=$("#authGate");if(!node){node=document.createElement("div");node.id="authGate";document.body.appendChild(node);}node.innerHTML=html;}
function gateForm(kind="login",message=""){
  const register=kind==="register";
  showGate(`<div class="authPanel"><div class="authBrand"><span class="authLogo">H</span><div><b>HARALD</b><small>GENIALE · SISTEMÁTICA OPERACIONAL</small></div></div><h1>${register?"Solicitar acesso":"Acessar sistemática"}</h1><p class="authDescription">${register?"Crie seu cadastro exclusivo para a HARALD. Sua senha do CIA, GitHub ou Supabase não cria automaticamente uma conta aqui. Depois, o administrador liberará seu acesso.":"Este é um sistema novo, com cadastro independente do CIA e do Supabase. Se nunca criou seu acesso HARALD, use Primeiro acesso abaixo."}</p>${message?`<div class="authMessage" role="status">${esc(message)}</div>`:""}<form id="haraldAuthForm"><label for="authEmail">E-mail</label><input id="authEmail" type="email" autocomplete="username" placeholder="seuemail@empresa.com" required/><label for="authPassword">Senha</label><input id="authPassword" type="password" minlength="8" autocomplete="${register?"new-password":"current-password"}" placeholder="Mínimo de 8 caracteres" required/><button class="authPrimary" type="submit">${register?"Cadastrar e solicitar liberação":"Entrar"}</button></form><button class="authLink" id="authSwitch" type="button">${register?"Já tenho cadastro · Entrar":"Primeiro acesso · Criar minha conta HARALD"}</button><small class="authFoot">A planilha e os contatos não são disponibilizados sem autorização.</small></div>`);
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
    }catch(err){const msg=String(err.message||err);const mapped=/invalid login credentials|invalid_credentials/i.test(msg)?"Este e-mail ainda não possui um acesso válido com essa senha na HARALD. Se é seu primeiro acesso, selecione Criar minha conta HARALD abaixo.":msg;gateForm(register?"register":"login",mapped);}
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
async function getAll(name,fields="*",filter=""){
  let all=[],offset=0;
  const extra=filter?"&"+filter:"";
  while(true){
    const rows=await api(`${name}?select=${encodeURIComponent(fields)}${extra}&limit=1000&offset=${offset}`);
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
    await beginNetworkWatch();
  }catch(e){gateForm("login","Falha ao conectar: "+e.message);}
}

async function loadData(){
 const [sourceRows,sourceStates,notes,timeline,privateSource]=await Promise.all([
  getAll("harald_horista_console_rows","*","is_current=eq.true"),
  getAll("harald_horista_source_state","*","source_key=eq.controle_operacional_horistas"),
  getAll("harald_notes","target_type,target_key,scenario_code,note_body"),
  getAll("harald_timeline","id,target_type,target_key,scenario_code,event_type,description,metadata,created_by,created_at"),
  role==="admin"?getAll("harald_horista_private_rows","*","is_current=eq.true"):Promise.resolve([])
 ]);
 if(!sourceRows.length)throw Error("A fonte oficial Horista ainda não foi publicada. Atualize o arquivo Controle Operacional Horistas.xlsx.");
 const sourceState=sourceStates[0]||null;
 const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();
 const digits=v=>String(v||"").replace(/\D/g,"");
 const personId=name=>"horista:"+norm(name).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
 const storeKey=row=>[row.sector_code,digits(row.cnpj),norm(row.store_name).replace(/[^a-z0-9]+/g,"-")].filter(Boolean).join("|");
 const dayMap={SEG:1,TER:2,QUA:3,QUI:4,SEX:5,SAB:6,DOM:7};
 const parseDays=value=>String(value||"").toLocaleUpperCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^A-Z]+/).map(x=>x==="QUAT"?"QUA":x).filter(x=>dayMap[x]);
 const sourceStatusToPerson=rows=>{
  const values=new Set(rows.map(x=>String(x.vacancy_status||"").toUpperCase()).filter(Boolean));
  if(values.has("ATIVO"))return "ATIVO";
  if(values.has("EM ADMISSÃO"))return "EM ADMISSÃO";
  if(values.has("CONTRATADO"))return "CONTRATADO";
  if(values.has("VAGA OPEN"))return "VINCULADO · REVISAR STATUS";
  return "VINCULADO";
 };
 const sourceStatusToConsole=rows=>{
  const vals=[...new Set(rows.map(x=>String(x.vacancy_status||"").toUpperCase()).filter(Boolean))];
  if(vals.length!==1)return null;
  return {ATIVO:"active","VAGA OPEN":"open","EM ADMISSÃO":"onboarding","CONTRATADO":"hired"}[vals[0]]||null;
 };
 const groups=new Map();
 for(const row of sourceRows){
  if(!groups.has(row.sector_code))groups.set(row.sector_code,[]);
  groups.get(row.sector_code).push(row);
 }
 const visibleStores=sourceRows.map(row=>{
  const id=storeKey(row)||("HCO|"+row.source_row);
  return {
   id,src:id,sc:"C2",sector:row.sector_code,n:row.store_name||"Loja não informada",city:row.city||"",uf:row.state_code||"",
   c:row.cnpj||"",b:row.banner||"",end:row.store_address||"",pri:row.priority||"",district:row.store_neighborhood||"",
   cep:row.store_postal_code||"",visitH:Number(row.service_time||0),visits1:Number(row.weekly_visits||0),model:"HORISTA",
   hours:Number(row.store_weekly_hours||0),teamHours:Number(row.team_weekly_hours||0),w1:row.days_week1||"",w2:row.days_week2||"",
   region:row.region||"",modal:row.modal||"",lat:row.received_lat??row.centroid_lat??"",lon:row.received_lon??row.centroid_lon??"",
   rev:row.reviewed||"Controle Operacional",phase:"HORISTAS",channel:"",legal:"",charge:1,
   weekKm:Number(row.km_store_week||0),rateAvg:Number(row.avg_displacement||0),
   situation:row.registration_pending||"",sourceObs:row.registration_pending||"",
   sourceStatus:row.vacancy_status||"",routeStatus:row.route_status||"",promoterName:row.promoter_name||""
  };
 });
 const visibleTeams=[...groups.entries()].map(([sector,rows])=>{
  const first=rows[0],cities=[...new Set(rows.map(x=>x.city).filter(Boolean))].join(", ");
  const teamHours=Number(rows.find(x=>x.team_weekly_hours!=null)?.team_weekly_hours||0);
  const reserve=Number(rows.find(x=>x.travel_reserve_hours!=null)?.travel_reserve_hours||0);
  const capacity=Number(rows.find(x=>x.capacity_weekly_hours!=null)?.capacity_weekly_hours||0);
  return {
   sc:"C2",sector,model:"HORISTA",uf:first.state_code||"",cities,pdvs:rows.length,
   visits:rows.reduce((a,x)=>a+Number(x.weekly_visits||0),0),hours:teamHours||rows.reduce((a,x)=>a+Number(x.store_weekly_hours||0),0),
   reserve,capacity,region:first.region||"",modal:first.modal||"",km1:Number(first.km_week1||0),km2:Number(first.km_week2||0),
   kmAvg:Number(first.km_month_avg||0),kmMonth:Number(first.km_month_avg||0),kmMaxDay:Number(first.km_max_day||0),
   totalPeakH:capacity||teamHours+reserve,situation:"Fonte oficial · Controle Operacional",
   sourceStatus:sourceStatusToConsole(rows),sourceStatusRaw:[...new Set(rows.map(x=>x.vacancy_status_raw).filter(Boolean))].join(" / "),
   hasPromoter:rows.some(x=>String(x.promoter_name||"").trim())
  };
 });
 const personGroups=new Map();
 for(const row of sourceRows){
  const name=String(row.promoter_name||"").trim();if(!name)continue;
  const id=personId(name);if(!personGroups.has(id))personGroups.set(id,[]);
  personGroups.get(id).push(row);
 }
 const persons=[...personGroups.entries()].map(([id,rows])=>{
  const first=rows.find(x=>x.phone||x.email)||rows[0];
  return {
   id,full_name:first.promoter_name,whatsapp:first.phone||"",registration_number:null,supervisor_name:null,supervisor_phone:null,
   status:sourceStatusToPerson(rows),hiring_type:"HORISTA",profile:"HORISTA",admission_date:null,scheduled_start_date:null,
   weekly_schedule:null,coordinator_name:null,geniale_manager:null,job_title:"Promotor Horista",
   employment_source:"Controle Operacional Horistas.xlsx",transport_mode:first.modal||null,vehicle_type:null,mob2:null,source_row:first.source_row
  };
 });
 const occupancies=[];
 for(const [sector,rows] of groups){
  const names=[...new Set(rows.map(x=>String(x.promoter_name||"").trim()).filter(Boolean))];
  if(!names.length)continue;
  occupancies.push({
   id:"source-occ:"+sector,scenario_code:"C2",sector_code:sector,promoter_id:personId(names[0]),
   start_date:null,end_date:null,change_reason:names.length>1?"Mais de um promotor informado na fonte":"Vínculo informado na fonte oficial",
   source_name:"CONTROLE_OPERACIONAL_HORISTAS",created_at:sourceState?.processed_at||null
  });
 }
 const sectorStatuses=[];
 for(const [sector,rows] of groups){
  const normalized=sourceStatusToConsole(rows);
  const raw=[...new Set(rows.map(x=>x.vacancy_status_raw).filter(Boolean))];
  if(!normalized&&!raw.length)continue;
  sectorStatuses.push({
   scenario_code:"C2",sector_code:sector,status:normalized,source_status:raw.join(" / "),effective_on:null,note:null,
   source_name:"CONTROLE_OPERACIONAL_HORISTAS",source_quality:raw.length>1?"mixed_rows":"source_sheet"
  });
 }
 const routeDays=[];
 for(const row of sourceRows){
  const key=storeKey(row)||("HCO|"+row.source_row);
  for(const [cycle,value] of [[1,row.days_week1],[2,row.days_week2]]){
   for(const d of parseDays(value))routeDays.push({scenario_code:"C2",sector_code:row.sector_code,store_key:key,cycle_week:cycle,weekday:dayMap[d],scheduled:true});
  }
 }
 const privateByName=new Map(privateSource.filter(x=>x.promoter_name).map(x=>[norm(x.promoter_name),x]));
 const privateRows=persons.map(p=>{
  const pub=personGroups.get(p.id)?.find(x=>x.email||x.promoter_city||x.promoter_state)||personGroups.get(p.id)?.[0]||{};
  const priv=privateByName.get(norm(p.full_name))||{};
  return {
   promoter_id:p.id,cpf:priv.cpf||null,rg:priv.rg||null,birth_date:priv.birth_date||null,personal_email:pub.email||null,
   personal_phone:pub.phone||null,street:priv.promoter_address||null,street_number:priv.promoter_address_number||null,
   complement:null,neighborhood:priv.promoter_neighborhood||null,city:pub.promoter_city||null,state_code:pub.promoter_state||null,
   postal_code:priv.promoter_postal_code||null,salary:null,meal_allowance:null,food_allowance:null,first_due_day:null,second_due_day:null,
   first_due_reference:null,second_due_reference:null,source_fields:{
    bank:priv.bank||null,bank_agency:priv.bank_agency||null,bank_account:priv.bank_account||null,bank_account_type:priv.bank_account_type||null,
    pix_key:priv.pix_key||null,device_os:priv.device_os||null,shirt_size:priv.shirt_size||null,boot_size:priv.boot_size||null
   }
  };
 });
 const ps={};promoterIds={};promoterNames={};personKeyToId={};
 for(const link of occupancies){
  const p=persons.find(x=>x.id===link.promoter_id);if(!p)continue;
  const rows=groups.get(link.sector_code)||[];
  ps[link.sector_code]={name:p.full_name||"",phone:p.whatsapp||"",badge:"",supervisor:"",supervisorPhone:"",situation:rows[0]?.vacancy_status||p.status||"Vínculo informado"};
  promoterIds[link.sector_code]=p.id;promoterNames[link.sector_code]=p.full_name;
  const dig=digits(p.whatsapp),uiKey=dig.length>=10?"phone:"+(dig.startsWith("55")?dig:"55"+dig):"name:"+norm(p.full_name);
  personKeyToId[uiKey]=p.id;
 }
 const savedCloud={promoters:ps,notes:{},sectorNotes:{},promoterNotes:{},favorites:{},author:"HARALD"};
 for(const n of notes){
  const group=n.target_type==="store"?"notes":n.target_type==="sector"?"sectorNotes":"promoterNotes";
  if(n.target_type==="promoter"){
   const k=Object.keys(personKeyToId).find(x=>personKeyToId[x]===n.target_key);if(k)savedCloud.promoterNotes[k]=n.note_body;
  }else savedCloud[group][n.target_key]=n.note_body;
 }
 legacySnapshot=window.haraldApp.getSnapshot();savedCloud.favorites=legacySnapshot.favorites||{};
 window.haraldApp.mount({stores:visibleStores,teams:visibleTeams,saved:savedCloud});
 baseline=clone(window.haraldApp.getSnapshot());isReady=true;
 document.body.classList.remove("auth-locked");document.body.classList.add("haraldSourceManaged");$("#authGate")?.remove();
 const header=$(".topTools");
 if(header&&!$("#cloudStatus")){const el=document.createElement("div");el.className="cloudUser";el.innerHTML='<span id="cloudStatus" aria-live="polite">☁ Fonte oficial</span><button type="button" id="haraldLogout" title="Encerrar sessão">Sair</button>';header.appendChild(el);$("#haraldLogout").onclick=logout;}
 setStatus("☁ Controle Operacional sincronizado");
 const sourceContracts=[{source_key:"horista",display_name:"Controle Operacional Horistas",expected_file_name:sourceState?.file_name||"Controle Operacional Horistas.xlsx",updated_at:sourceState?.processed_at||null,notes:{source_of_truth:true,scope:"HORISTA_ONLY",library_file_id:sourceState?.library_file_id||null}}];
 window.haraldPeople?.hydrate({persons,occupancies,notes,timeline,privateRows,teams:visibleTeams,stores:visibleStores,role,sourceManaged:true,api});
 window.haraldDashboard?.hydrate({persons,occupancies,routeDays,sectorStatuses,sectorCandidates:[],actualVisits:[],actualImports:[],sourceContracts,sourceState,stores:visibleStores,teams:visibleTeams,role});
 window.haraldApp?.refresh?.();
}
async function savePerson(){
 throw Error("Dados operacionais são geridos no chat Controle Operacional e sincronizados pelo arquivo oficial. Atualize a fonte, não o Console.");
}
async function saveNote(kind,key,value){
  const scenario=kind==="sector"?(key.startsWith("GH1-")?"C1":"C2"):null;
  if(kind==="promoter")key=personKeyToId[key]||key;
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

async function latestNetworkRun(){
 const rows=await api("harald_sync_runs?select=id,imported_at&order=id.desc&limit=1");
 return rows?.[0]?.id||0;
}
async function beginNetworkWatch(){
 if(role!=="admin"||networkWatchTimer)return;
 try{lastNetworkRunId=await latestNetworkRun();}catch(err){console.warn("HARALD watcher:",err.message);return;}
 networkWatchTimer=setInterval(async ()=>{
   if(!session||role!=="admin"||!isReady||networkWatchBusy||document.visibilityState==="hidden"||running)return;
   networkWatchBusy=true;
   try{
    const newest=await latestNetworkRun();
    if(newest<=lastNetworkRunId)return;
    if(document.querySelector("input:focus, textarea:focus, .hpModalShade, .hpDialog")){
      setStatus("☁ Planilha atualizada · recarregue");
      return;
    }
    await loadData();
    lastNetworkRunId=newest;
    setStatus("☁ Planilha sincronizada");
   }catch(err){console.warn("HARALD network updates:",err.message);}finally{networkWatchBusy=false;}
 },60000);
}
async function logout(){
 if(networkWatchTimer){clearInterval(networkWatchTimer);networkWatchTimer=null;}lastNetworkRunId=0;
 try{if(session)await fetch(BASE+"/auth/v1/logout",{method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+session.access_token}});}catch(e){}
 window.haraldPeople?.reset();
 clearSession();isReady=false;role=null;baseline=null;currentUser=null;
 document.body.classList.remove("haraldViewer");
 gateForm("login","Você saiu da sistemática com segurança.");
}
async function start(){
 document.body.classList.add("auth-locked");
 try{session=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");}catch(e){session=null;}
 if(session?.access_token){await enter();}else gateForm();
}
window.haraldCloud={start,scheduleSync,reload:loadData,isReady:()=>isReady,role:()=>role};
})();