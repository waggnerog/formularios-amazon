(function peopleModule(){
"use strict";
const state={people:[],occupancies:[],timeline:[],notes:[],privateRows:[],sectors:[],stores:[],role:"viewer",scenario:"C2",filter:"ALL",contact:"ALL",search:"",screen:"sectors",sector:null,person:null,store:null,reveal:false,api:null,loading:false};
let root=null;
const E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const D=v=>{if(!v)return "Não informado";const x=new Date(v+"T12:00:00");return isNaN(x.getTime())?E(v):x.toLocaleDateString("pt-BR");};
const days=date=>{if(!date)return null;const now=new Date();now.setHours(0,0,0,0);const d=new Date(date+"T00:00:00");return Math.round((d-now)/86400000);};
const initials=name=>String(name||"?").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
const okWrite=()=>["admin","editor"].includes(state.role);
const dateNow=()=>new Date().toLocaleDateString("sv-SE");
const pby=id=>state.people.find(p=>p.id===id);
const privateBy=id=>state.privateRows.find(p=>p.promoter_id===id);
const sectorBy=(s,sc=state.scenario)=>state.sectors.find(t=>t.sc===sc&&t.sector===s);
const occupancyBy=(s,sc=state.scenario)=>state.occupancies.filter(x=>x.scenario_code===sc&&x.sector_code===s).sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)));
const openOcc=(s,sc=state.scenario)=>occupancyBy(s,sc).find(x=>!x.end_date);
const occPerson=id=>state.occupancies.filter(o=>o.promoter_id===id).sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)));
const badge=(text,cls="")=>`<span class="hpBadge ${cls}">${E(text)}</span>`;
const detail=(k,v)=>`<div class="hpDetail"><span>${E(k)}</span><strong>${E(v??"Não informado")}</strong></div>`;
const statusFor=(o,p)=>{
 if(!o)return {label:"Sem cadastro",cls:"muted"};
 if(o.end_date)return {label:"Encerrado",cls:"muted"};
 const delta=days(o.start_date);
 if(delta!==null&&delta>0)return {label:"Início previsto · "+D(o.start_date),cls:"scheduled"};
 if(p?.status==="DESLIGADO")return {label:"Cadastro desligado · revisar",cls:"danger"};
 return {label:"Alocado desde "+D(o.start_date),cls:"active"};
};
const model=t=>t?.model==="FULLTIME"?"Fulltime":t?.model==="PARTTIME"?"Parttime":"Horista";
const contract=t=>t?.model==="HORISTA"?"HORISTA":"CLT";
const friendlyStatus=v=>v==="ATIVO"?"Ativo no cadastro":v==="PENDENTE"?"Pendente":v==="DESLIGADO"?"Desligado":v||"Não informado";
const sectorList=()=>state.sectors.filter(t=>t.sc===state.scenario&&(state.filter==="ALL"||contract(t)===state.filter)).filter(t=>{
 const p=pby(openOcc(t.sector)?.promoter_id);
 return (state.contact==="ALL"||(state.contact==="WITH"?hasPeoplePhone(p):!hasPeoplePhone(p)))&&(!state.search||[t.sector,t.uf,t.cities,t.model,p?.full_name,p?.registration_number,p?.whatsapp].join(" ").toLocaleLowerCase("pt-BR").includes(state.search.toLocaleLowerCase("pt-BR")));
});
function header(){
 return `<header class="hpHeader"><div class="hpBrand"><div class="hpMark">H</div><div><b>GENIALE <span>· HARALD</span></b><small>Central de equipes e histórico</small></div></div><div class="hpHeaderRight"><span class="hpSecure">🔒 ${state.role==="admin"?"Administrador":state.role==="editor"?"Editor":"Consulta"}</span><button type="button" class="hpClose" data-hpa="close" title="Voltar ao painel">✕ <span>Voltar ao painel</span></button></div></header>`;
}
function navigation(){
 const opts=[["sectors","▦","Setores e vagas"],["people","♙","Promotores"],["timeline","◷","Linha do tempo"]];
 return `<div class="hpSideNav"><div class="hpSideTitle">CONTROLE OPERACIONAL</div>${opts.map(([id,ico,label])=>`<button class="hpSideBtn ${(state.screen===id||(state.screen==="sector"&&id==="sectors"))?"sel":""}" data-hpa="nav" data-id="${id}"><span>${ico}</span>${label}</button>`).join("")}<div class="hpSideTitle hpSideTitleLower">ATENÇÃO</div><div class="hpGuide"><b>Setor = vaga permanente</b><p>Trocar promotor não altera lojas, roteiro nem o código do setor. A ocupação anterior permanece no histórico.</p></div></div>`;
}
function bread(){
 const entry=state.screen==="sector"?"Histórico do setor":state.screen==="person"?"Ficha do promotor":state.screen==="store"?"Histórico da loja":state.screen==="people"?"Promotores":state.screen==="timeline"?"Linha do tempo":"Setores e vagas";
 return `<div class="hpCrumb">HARALD / <b>${entry}</b></div>`;
}
function controls(forceList=false){
 if(!forceList&&["sector","person","store"].includes(state.screen))return `<button class="hpSoft" data-hpa="back">← Voltar à visão geral</button>`;
 return `<div class="hpControls"><div class="hpSearchBox"><span>⌕</span><input id="hpSearch" placeholder="Buscar setor, cidade, promotor ou matrícula" value="${E(state.search)}" aria-label="Pesquisar registros" /></div><select id="hpScenario" aria-label="Etapa da operação"><option value="C1" ${state.scenario==="C1"?"selected":""}>Etapa 1</option><option value="C2" ${state.scenario==="C2"?"selected":""}>Operação completa</option></select><select id="hpContactFilter" aria-label="Filtro por contato"><option value="ALL" ${state.contact==="ALL"?"selected":""}>Todos os contatos</option><option value="WITH" ${state.contact==="WITH"?"selected":""}>✓ Com contato</option><option value="WITHOUT" ${state.contact==="WITHOUT"?"selected":""}>! Sem contato</option></select><div class="hpSegment" role="group" aria-label="Tipo de vínculo">${[["ALL","Todos"],["CLT","CLT"],["HORISTA","Horistas"]].map(([id,label])=>`<button class="${state.filter===id?"sel":""}" data-hpa="filter" data-id="${id}">${label}</button>`).join("")}</div></div>`;
}
function dash(){
 const teams=sectorList(),occupied=teams.filter(t=>!!openOcc(t.sector)),upcoming=occupied.filter(t=>{const o=openOcc(t.sector);return days(o.start_date)>0}),missing=teams.length-occupied.length;
 return `<div class="hpMetrics">${[
  ["Setores no filtro",teams.length,"Total de vagas/roteiros","blue"],
  ["Com promotor",occupied.length,"Cadastro vinculado ao setor","green"],
  ["Inícios previstos",upcoming.length,"Com admissão futura","amber"],
  ["Sem cadastro",missing,"Não significa vaga oficialmente aberta","grey"]].map(x=>`<div class="hpMetric ${x[3]}"><div>${E(x[0])}</div><strong>${x[1].toLocaleString("pt-BR")}</strong><small>${E(x[2])}</small></div>`).join("")}</div>`;
}
function hasPeoplePhone(p){
 const digits=String(p?.whatsapp||"").replace(/\D/g,"");
 return digits.length===10||digits.length===11||(digits.startsWith("55")&&(digits.length===12||digits.length===13));
}
function hasSectorPhone(t){
 const p=pby(openOcc(t.sector)?.promoter_id);
 return hasPeoplePhone(p);
}
function peopleContactCount(items){
 const yes=items.filter(hasSectorPhone).length;
 return `<div class="hpContactCounts"><span class="hpBadge active">✓ ${yes} com contato</span><span class="hpBadge scheduled">! ${items.length-yes} sem contato</span></div>`;
}
function sectorCard(t){
 const o=openOcc(t.sector),p=pby(o?.promoter_id),st=statusFor(o,p),history=occupancyBy(t.sector).length,has=hasPeoplePhone(p);
 return `<button class="hpSectorListRow ${has?"":"noContact"}" type="button" data-hpa="openSector" data-sector="${E(t.sector)}" aria-label="Abrir ficha e histórico do setor ${E(t.sector)}, ${has?"com contato":"sem contato"}">
 <span class="hpSectorId"><strong>${E(t.sector)}</strong><small>${E(model(t))} · ${E(t.modal||"Modal não informado")}</small></span>
 <span class="hpSectorCities">${E(t.cities||t.uf||"Cidades não informadas")}</span>
 <span class="hpSectorOwner"><span class="hpAvatar">${E(initials(p?.full_name))}</span><span><strong>${E(p?.full_name||"Sem promotor")}</strong><small>${E(p?.registration_number?"Matrícula "+p.registration_number:"Matrícula pendente")}</small></span></span>
 <span class="hpSectorContact">${badge(has?"✓ Com contato":"! Sem contato",has?"active":"scheduled")}<small>${has?E(p.whatsapp):"Telefone ausente ou inválido"}</small></span>
 <span class="hpSectorHours"><strong>${E(t.pdvs||0)} lojas</strong><small>${E(t.hours||0)}h / semana</small></span>
 <span class="hpSectorArrow" aria-hidden="true">›</span>
 </button>`;
}
function renderSectors(){
 const teams=sectorList(),withContacts=teams.filter(hasSectorPhone).length;
 const list=teams.slice(0,500);
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">VISÃO PRINCIPAL</span><h1>Setores e responsáveis</h1><p>Lista de setores permanentes. Clique na linha para abrir a ficha completa e o histórico em um painel lateral.</p></div></div>${controls(true)}${dash()}
 <div class="hpSubhead"><h2>${teams.length} setores encontrados</h2>${peopleContactCount(teams)}</div>
 <div class="hpSectorListHeader" aria-hidden="true"><span>SETOR / MODELO</span><span>CIDADES</span><span>RESPONSÁVEL</span><span>CONTATO</span><span>ATENDIMENTO</span><span></span></div>
 <div class="hpSectorRows" aria-label="Lista de setores">${list.map(sectorCard).join("")}</div>
 ${teams.length>500?`<div class="hpHint">Exibindo 500 setores; use a busca e os filtros para localizar os demais.</div>`:""}
 ${!teams.length?`<div class="hpEmpty">Nenhum setor corresponde aos filtros selecionados.</div>`:""}`;
}
function personCard(p){
 const occ=occPerson(p.id).find(x=>x.scenario_code===state.scenario&&x.end_date===null)||occPerson(p.id).find(x=>x.scenario_code===state.scenario);
 const st=statusFor(occ,p);
 return `<article class="hpPersonCard"><div class="hpAvatar large">${E(initials(p.full_name))}</div><div class="hpPersonMain"><strong>${E(p.full_name)}</strong><small>${E(p.registration_number?"Matrícula "+p.registration_number:"Matrícula pendente")} · ${E(p.profile||"Perfil a confirmar")}</small><div class="hpInline">${badge(p.status||"Não informado",p.status==="ATIVO"?"active":"muted")}${badge(st.label,st.cls)}</div></div><div class="hpPersonSide"><strong>${E(occ?.sector_code||"Sem setor")}</strong><span>${E(p.transport_mode||"Modal não informado")}${p.vehicle_type?" · "+E(p.vehicle_type):""}</span><button data-hpa="openPerson" data-id="${E(p.id)}" class="hpSoft">Ver ficha completa →</button></div></article>`;
}
function renderPeople(){
 const q=state.search.toLocaleLowerCase("pt-BR");
 const list=state.people.filter(p=>{
 const o=occPerson(p.id).find(x=>x.scenario_code===state.scenario);
 if(!o)return false;
 if(state.filter!=="ALL" && p.hiring_type!==state.filter && contract(sectorBy(o.sector_code))!==state.filter)return false;
 if(state.contact!=="ALL"&&(state.contact==="WITH"?!hasPeoplePhone(p):hasPeoplePhone(p)))return false;
 return !q||[p.full_name,p.registration_number,p.profile,p.status,o.sector_code].join(" ").toLocaleLowerCase("pt-BR").includes(q);
 }).sort((a,b)=>a.full_name.localeCompare(b.full_name,"pt-BR"));
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">CADASTRO DE PESSOAS</span><h1>Promotores</h1><p>O profissional tem seu próprio cadastro. A lotação e as substituições ficam no histórico do setor.</p></div></div>${controls()}<div class="hpSubhead"><h2>${list.length} profissionais cadastrados</h2>${badge("Dados pessoais protegidos","violet")}</div><div class="hpPersonList">${list.map(personCard).join("")}</div>${!list.length?`<div class="hpEmpty">Nenhum profissional corresponde a esta busca.</div>`:""}`;
}
const eventText=evt=>{
 const p=pby(evt.metadata?.promoter_id);
 if(evt.event_type==="occupancy_start")return `Vínculo de ${p?.full_name||"profissional"} registrado · início ${D(evt.metadata?.start_date)}`;
 if(evt.event_type==="occupancy_end")return `Ocupação encerrada${p?" · "+p.full_name:""} · até ${D(evt.metadata?.end_date)}${evt.metadata?.reason?" · "+evt.metadata.reason:""}`;
 if(evt.event_type==="note")return evt.description||"Anotação sem texto";
 return evt.description||"Alteração no histórico";
};
function timeline(target,key,scenario=null,emptyMessage="Ainda não há ocorrências registradas."){
 const list=state.timeline.filter(x=>x.target_type===target&&x.target_key===key&&(!scenario||x.scenario_code===scenario)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 return `<div class="hpTimeList">${list.map((x,i)=>`<div class="hpTimeItem"><div class="hpTimeDot ${x.event_type==="note"?"note":""}"></div><div class="hpTimeBody"><div class="hpTimeHead"><b>${E(x.event_type==="note"?"Anotação":x.event_type==="occupancy_start"?"Vinculação":x.event_type==="occupancy_end"?"Substituição / saída":x.event_type==="status_change"?"Alteração cadastral":"Registro")}</b><span>${new Date(x.created_at).toLocaleString("pt-BR")}</span></div><p>${E(eventText(x))}</p><small>${x.created_by?"Registrado por usuário autorizado":"Registro de importação"}</small></div></div>`).join("")}</div>${!list.length?`<div class="hpEmpty tiny">${E(emptyMessage)}</div>`:""}`;
}
function noteForm(kind,key,scenario=null){
 if(!okWrite())return `<p class="hpHint">Seu perfil permite consultar, mas não registrar anotações.</p>`;
 return `<form class="hpNoteForm" data-form="note"><input type="hidden" name="kind" value="${E(kind)}"/><input type="hidden" name="key" value="${E(key)}"/><input type="hidden" name="scenario" value="${E(scenario||"")}"/><label>Nova anotação no histórico</label><textarea name="body" rows="3" minlength="2" maxlength="5000" placeholder="Registre o fato, a orientação ou a pendência. O histórico anterior não será apagado." required></textarea><div class="hpFormFoot"><small>Não inclua CPF, RG, dados bancários ou outras informações sensíveis nas anotações compartilhadas.</small><button type="submit" class="hpPrimary">Registrar anotação</button></div></form>`;
}

function storeKey(s){
 const c=String(s.c||"").replace(/\D/g,"");
 const norm=x=>String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 return c.length===14?"cnpj:"+c:"loja:"+norm([s.n,s.city,s.uf].join("|"));
}
function renderStore(){
 const s=state.stores.find(x=>x.id===state.store);
 if(!s)return '<div class="hpEmpty">Loja não localizada no cenário.</div>';
 const key=storeKey(s);
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">FICHA E HISTÓRICO DO PONTO DE VENDA</span><h1>${E(s.n)}</h1><p>${E(s.b)} · ${E(s.city)} / ${E(s.uf)} · Setor ${E(s.sector)}</p></div>${badge(s.pri||"Prioridade não informada","blue")}</div>${controls()}
 <div class="hpHeroGrid"><div class="hpHeroCard"><span>01 / LOJA</span><strong>${E(s.n)}</strong><p>${E(s.end||"Endereço não informado")}</p><div class="hpHeroFacts">${detail("Semana 1",s.w1||"Sem visita informada")}${detail("Semana 2",s.w2||"Sem visita informada")}${detail("Horas/semana",s.hours)}${detail("Tempo/visita",s.visitH)}</div></div><div class="hpHeroCard person"><span>02 / VAGA PERMANENTE</span><strong>${E(s.sector)}</strong><p>O histórico do setor é independente do histórico específico desta loja.</p><button class="hpSoft" data-hpa="openSector" data-sector="${E(s.sector)}" data-scenario="${E(s.sc)}">Abrir setor e substituições →</button></div></div>
 <section class="hpPanel"><div class="hpPanelTitle"><h2>Anotações e histórico da loja</h2><span class="hpPanelHint">Os registros não são apagados quando o promotor muda.</span></div>${noteForm("store",key)}${timeline("store",key)}</section>`;
}

function renderSector(){
 const t=sectorBy(state.sector),occ=occupancyBy(state.sector),o=openOcc(state.sector),p=pby(o?.promoter_id);
 if(!t)return `<div class="hpEmpty">Setor não localizado.</div>`;
 const st=statusFor(o,p);
 const storeList=state.stores.filter(x=>x.sc===state.scenario&&x.sector===t.sector);
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">SETOR PERMANENTE · ${E(t.uf)}</span><h1>${E(t.sector)}</h1><p>${E(t.cities||"")} · ${E(t.region||"")}</p></div>${badge(model(t),"blue")}</div>${controls()}
 <div class="hpHeroGrid"><div class="hpHeroCard"><span>01 / VAGA E ROTEIRO</span><strong>${E(t.sector)}</strong><p>O código, a carga e as lojas permanecem iguais quando o responsável muda.</p><div class="hpHeroFacts">${detail("PDVs",t.pdvs)}${detail("Visitas semanais",t.visits)}${detail("Atendimento",String(t.hours||0)+"h")}${detail("Transporte",t.modal)}</div></div><div class="hpHeroCard person"><span>02 / RESPONSÁVEL VINCULADO</span><div class="hpHeroPerson"><div class="hpAvatar large">${E(initials(p?.full_name))}</div><div><strong>${E(p?.full_name||"Sem cadastro")}</strong>${badge(st.label,st.cls)}</div></div><p>${p?.profile?"Perfil "+E(p.profile)+" · ":""}${p?.registration_number?"Matrícula "+E(p.registration_number):"Matrícula pendente"}</p>${p?`<button class="hpSoft" data-hpa="openPerson" data-id="${E(p.id)}">Abrir ficha do promotor →</button>`:""}${okWrite()?`<button class="hpPrimary" data-hpa="replace">＋ ${p?"Registrar substituição":"Alocar promotor"}</button>`:""}</div></div>
 <div class="hpTwoCols"><section class="hpPanel"><div class="hpPanelTitle"><h2>Histórico de ocupação</h2>${badge(`${occ.length} registro(s)`,"violet")}</div><div class="hpOccupancies">${occ.map(x=>{const who=pby(x.promoter_id),ss=statusFor(x,who);return `<div class="hpOccupancy"><div class="hpOccupancyTop"><b>${E(who?.full_name||"Profissional não encontrado")}</b>${badge(ss.label,ss.cls)}</div><small>${D(x.start_date)} → ${x.end_date?D(x.end_date):"sem encerramento informado"}</small>${x.change_reason?`<p>Motivo: ${E(x.change_reason)}</p>`:""}<button class="hpTextBtn" data-hpa="openPerson" data-id="${E(x.promoter_id)}">Ver ficha e anotações →</button></div>`}).join("")}</div>${!occ.length?`<div class="hpEmpty tiny">Nenhuma ocupação cadastrada. O setor permanece na sistemática.</div>`:""}</section>
 <section class="hpPanel"><div class="hpPanelTitle"><h2>Lojas do setor</h2>${badge(`${storeList.length} PDVs`,"blue")}</div><div class="hpMiniStores">${storeList.slice(0,30).map(x=>`<div><b>${E(x.n)}</b><span>${E(x.city)} / ${E(x.uf)} · ${E(x.w1||"Semana 1 sem visita")}</span></div>`).join("")}</div></section></div>
 <section class="hpPanel"><div class="hpPanelTitle"><h2>Linha do tempo do setor</h2><span class="hpPanelHint">Anotações continuam aqui mesmo após substituições</span></div>${noteForm("sector",t.sector,state.scenario)}${timeline("sector",t.sector,state.scenario)}</section>
 ${state.replace?replaceForm(t,o):""}`;
}
function replaceForm(t,occ){
 const st=occ?`A ocupação anterior será encerrada e permanecerá no histórico. Início atual: ${D(occ.start_date)}.`:"O setor ainda não possui promotor cadastrado.";
 const min=occ?.start_date||dateNow();
 return `<div class="hpModalShade" id="hpReplaceModal"><form class="hpDialog" data-form="replace"><div class="hpDialogTop"><div><small>ALTERAÇÃO CONTROLADA</small><h2>${occ?"Substituir ocupante":"Vincular novo promotor"}</h2></div><button type="button" data-hpa="cancelReplace" class="hpClose">✕</button></div><p>${E(st)} O código <b>${E(t.sector)}</b> e seu roteiro não serão alterados.</p>${occ?`<label>Data de saída do profissional anterior</label><input required type="date" name="endDate" min="${E(min)}" value="${E(min)}" />`:""}
 <label>Data de início do novo profissional</label><input required type="date" name="startDate" min="${E(min)}" value="${E(occ?new Date(new Date(min+"T12:00:00").getTime()+86400000).toLocaleDateString("sv-SE"):dateNow())}" />
 <label>Nome completo do substituto</label><input required name="name" minlength="3" placeholder="Nome completo" />
 <label>WhatsApp (opcional)</label><input name="phone" inputmode="tel" placeholder="DDD + telefone" />
 <label>Motivo ou justificativa</label><textarea name="reason" minlength="5" placeholder="Por que esta ocupação está sendo alterada?" required></textarea>
 <div class="hpDialogActions"><button type="button" class="hpSoft" data-hpa="cancelReplace">Cancelar</button><button type="submit" class="hpPrimary">Confirmar e preservar histórico</button></div></form></div>`;
}
function renderPerson(){
 const p=pby(state.person),o=p?occPerson(p.id)[0]:null,pr=privateBy(p?.id);
 if(!p)return `<div class="hpEmpty">Profissional não encontrado.</div>`;
 const restricted=state.role==="admin";
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">FICHA INDIVIDUAL DO PROFISSIONAL</span><h1>${E(p.full_name)}</h1><p>${E(p.job_title||"Promotor de merchandising")} · ${E(p.coordinator_name||"Coordenação não informada")}</p></div><div>${badge(friendlyStatus(p.status),p.status==="ATIVO"?"active":"muted")}${badge(p.profile||"Perfil pendente","violet")}</div></div>${controls()}
 <div class="hpPersonHeader"><div class="hpAvatar xl">${E(initials(p.full_name))}</div><div class="hpPersonHeaderMain"><span>MATRÍCULA</span><strong>${E(p.registration_number||"Pendente de cadastro")}</strong><small>Início previsto / admissão: ${D(p.admission_date||o?.start_date)} · ${E(p.hiring_type||"Tipo pendente")}</small></div><div class="hpPersonHeaderActions">${p.whatsapp?`<button class="hpWhatsapp" data-hpa="whatsapp">◉ Enviar WhatsApp</button>`:""}${okWrite()?`<button class="hpSoft" data-hpa="editPerson">Editar status e perfil</button>`:""}</div></div>
 <div class="hpTwoCols"><section class="hpPanel"><div class="hpPanelTitle"><h2>Identificação operacional</h2></div><div class="hpDetails">${detail("Perfil",p.profile)}${detail("Status administrativo",p.status)}${detail("Matrícula",p.registration_number||"Pendente")}${detail("Cargo",p.job_title)}${detail("Jornada",p.weekly_schedule)}${detail("Coordenadora",p.coordinator_name)}${detail("Gestão Geniale",p.geniale_manager)}${detail("Tipo de contratação",p.hiring_type)}</div></section>
 <section class="hpPanel"><div class="hpPanelTitle"><h2>Logística e contato</h2></div><div class="hpDetails">${detail("Modal",p.transport_mode)}${detail("Veículo",p.vehicle_type)}${detail("MOB2",p.mob2)}${detail("Telefone / WhatsApp",p.whatsapp)}${detail("Setor vinculado",o?.sector_code||"Sem setor")}${detail("Início",D(o?.start_date))}</div>${o?`<button class="hpSoft" data-hpa="openSector" data-sector="${E(o.sector_code)}" data-scenario="${E(o.scenario_code)}">Abrir setor e histórico →</button>`:""}</section></div>
 ${restricted?`<section class="hpPanel"><div class="hpPanelTitle"><div><h2>Dados pessoais e RH</h2><p>Restrito à administração · informações protegidas</p></div>${badge("Acesso restrito","violet")}</div>${pr?`<div class="hpDetails sensitive">${detail("CPF",state.reveal?pr.cpf:"•••.•••.•••-••")}${detail("RG",pr.rg)}${detail("Nascimento",D(pr.birth_date))}${detail("E-mail pessoal",pr.personal_email)}${detail("Telefone particular",pr.personal_phone)}${detail("Endereço",`${pr.street||""}, ${pr.street_number||""}${pr.complement?" · "+pr.complement:""} · ${pr.neighborhood||""}`)}${detail("Cidade / UF / CEP",`${pr.city||""} / ${pr.state_code||""} · ${pr.postal_code||""}`)}${detail("Salário",pr.salary!=null?"R$ "+Number(pr.salary).toLocaleString("pt-BR",{minimumFractionDigits:2}):"Não informado")}${detail("VR / VA",`${pr.meal_allowance||"—"} / ${pr.food_allowance||"—"}`)}${detail("1 VENC. / 2 VENC.",`${pr.first_due_day||"—"} / ${pr.second_due_day||"—"}`)}${detail("VENCIMENTO 1 / 2",`${pr.first_due_reference||"—"} / ${pr.second_due_reference||"—"}`)}</div><div class="hpInline"><button class="hpSoft" data-hpa="reveal">${state.reveal?"Ocultar CPF":"Exibir CPF"}</button>${okWrite()?`<button class="hpSoft" data-hpa="editPrivate">Editar dados pessoais</button>`:""}</div><details class="hpExtras"><summary>Outros campos da planilha (uniformes, benefícios e equipamentos)</summary><div class="hpDetails">${Object.entries(pr.source_fields||{}).filter(([k,v])=>v!==null&&v!=="").map(([k,v])=>detail(k,typeof v==="object"?JSON.stringify(v):String(v))).join("")}</div></details>`:`<p class="hpHint">Dados pessoais ainda não cadastrados neste registro.</p>`}</section>`:`<section class="hpPrivateNotice"><b>🔒 Dados pessoais protegidos</b><p>CPF, nascimento, endereço e informações financeiras aparecem somente para administradores autorizados.</p></section>`}
 <section class="hpPanel"><div class="hpPanelTitle"><h2>Histórico do profissional</h2><span class="hpPanelHint">Ocorrências pessoais não migram para o substituto</span></div><div class="hpOccupancies">${occPerson(p.id).map(x=>`<div class="hpOccupancy"><b>${E(x.sector_code)}</b><small>${D(x.start_date)} → ${x.end_date?D(x.end_date):"vínculo em aberto"}</small>${x.change_reason?`<p>${E(x.change_reason)}</p>`:""}</div>`).join("")}</div>${noteForm("promoter",p.id)}${timeline("promoter",p.id)}</section>${state.editForm?personEditForm(p,pr):""}`;
}
function personEditForm(p,pr){
 const privateMode=state.editForm==="private";
 return `<div class="hpModalShade"><form class="hpDialog" data-form="${privateMode?"editPrivate":"editPerson"}"><div class="hpDialogTop"><div><small>CADASTRO PERMANENTE</small><h2>${privateMode?"Editar dados restritos":"Atualizar status e perfil"}</h2></div><button class="hpClose" type="button" data-hpa="cancelEdit">✕</button></div>
 ${privateMode?`
 <label>CPF (11 números) ${pr?"· identidade preservada":"· obrigatório no primeiro cadastro"}</label><input name="cpf" inputmode="numeric" maxlength="11" pattern="[0-9]{11}" ${pr?"readonly":"required"} value="${E(pr?.cpf||"")}"/>
 <label>RG</label><input name="rg" value="${E(pr?.rg||"")}"/>
 <label>Telefone particular</label><input name="personal_phone" value="${E(pr?.personal_phone||"")}"/>
 <label>Salário (R$)</label><input name="salary" inputmode="decimal" type="number" min="0" step="0.01" value="${E(pr?.salary||"")}"/>
 <label>VR (R$)</label><input name="meal_allowance" inputmode="decimal" type="number" min="0" step="0.01" value="${E(pr?.meal_allowance||"")}"/>
 <label>VA (R$)</label><input name="food_allowance" inputmode="decimal" type="number" min="0" step="0.01" value="${E(pr?.food_allowance||"")}"/>
 <label>Data de nascimento</label><input type="date" name="birth_date" value="${E(pr?.birth_date||"")}"/>
 <label>E-mail particular</label><input type="email" name="personal_email" value="${E(pr?.personal_email||"")}"/>
 <label>Endereço</label><input name="street" value="${E(pr?.street||"")}"/>
 <label>Número</label><input name="street_number" value="${E(pr?.street_number||"")}"/>
 <label>Complemento</label><input name="complement" value="${E(pr?.complement||"")}"/>
 <label>Bairro</label><input name="neighborhood" value="${E(pr?.neighborhood||"")}"/>
 <label>Cidade</label><input name="city" value="${E(pr?.city||"")}"/>
 <label>UF</label><input name="state_code" value="${E(pr?.state_code||"")}"/>
 <label>CEP</label><input name="postal_code" value="${E(pr?.postal_code||"")}"/>
 <label>1 VENC.</label><input name="first_due_day" value="${E(pr?.first_due_day||"")}"/>
 <label>2 VENC.</label><input name="second_due_day" value="${E(pr?.second_due_day||"")}"/>
 <label>VENCIMENTO 1 (valor original da planilha)</label><input name="first_due_reference" value="${E(pr?.first_due_reference||"")}"/>
 <label>VENCIMENTO 2 (valor original da planilha)</label><input name="second_due_reference" value="${E(pr?.second_due_reference||"")}"/>
 `:`
 <label>Status administrativo</label><select name="status">${["ATIVO","PENDENTE","AFASTADO","FÉRIAS","DESLIGADO"].map(x=>`<option ${p.status===x?"selected":""}>${x}</option>`).join("")}</select>
 <label>Perfil</label><input name="profile" value="${E(p.profile||"")}"/>
 <label>Matrícula</label><input name="registration_number" value="${E(p.registration_number||"")}" />
 <label>WhatsApp</label><input name="whatsapp" value="${E(p.whatsapp||"")}"/>
 <label>Modal</label><select name="transport_mode"><option value="">Não informado</option>${["VT","KM"].map(x=>`<option ${p.transport_mode===x?"selected":""}>${x}</option>`).join("")}</select>
 <label>Tipo de veículo</label><input name="vehicle_type" value="${E(p.vehicle_type||"")}"/>
 <label>Data de admissão</label><input type="date" name="admission_date" value="${E(p.admission_date||"")}"/>
 <label>Jornada semanal</label><input name="weekly_schedule" value="${E(p.weekly_schedule||"")}"/>
 <label>Coordenador(a)</label><input name="coordinator_name" value="${E(p.coordinator_name||"")}"/>
 <label>Gestão Geniale</label><input name="geniale_manager" value="${E(p.geniale_manager||"")}"/>
 <label>Tipo de contratação</label><select name="hiring_type">${["CLT","HORISTA"].map(x=>`<option ${p.hiring_type===x?"selected":""}>${x}</option>`).join("")}</select>
 <label>MOB2</label><select name="mob2"><option value="">Não informado</option>${["SIM","NÃO"].map(x=>`<option ${p.mob2===x?"selected":""}>${x}</option>`).join("")}</select>
 `}<div class="hpDialogActions"><button class="hpSoft" data-hpa="cancelEdit" type="button">Cancelar</button><button class="hpPrimary" type="submit">Salvar alterações</button></div></form></div>`;
}
function renderTimeline(){
 const sectors=sectorList().filter(t=>state.timeline.some(x=>x.target_type==="sector"&&x.target_key===t.sector&&x.scenario_code===t.sc));
 return `<div class="hpTitleRow"><div><span class="hpEyebrow">RASTREABILIDADE</span><h1>Linha do tempo</h1><p>Veja substituições e anotações sem perder os registros anteriores.</p></div></div>${controls()}<div class="hpPanel"><div class="hpPanelTitle"><h2>Setores com registros</h2></div><div class="hpTimelineList">${sectors.slice(0,50).map(t=>`<button class="hpTimelineRow" data-hpa="openSector" data-sector="${E(t.sector)}"><strong>${E(t.sector)}</strong><span>${E(t.cities||t.uf||"")}</span>${badge(state.timeline.filter(x=>x.target_type==="sector"&&x.target_key===t.sector).length+" eventos","violet")}</button>`).join("")}</div>${!sectors.length?`<div class="hpEmpty">Ainda não há registros históricos neste filtro.</div>`:""}</div>`;
}
function layout(){
 const inner=state.screen==="sectors"||state.screen==="sector"?renderSectors():state.screen==="people"?renderPeople():state.screen==="person"?renderPerson():state.screen==="store"?renderStore():renderTimeline();
 return `<div class="hpShell">${header()}<div class="hpBody"><aside class="hpSidebar">${navigation()}</aside><main class="hpMain">${bread()}${inner}<footer class="hpFooter">Sistemática HARALD · dados autenticados do Supabase · preservação de histórico</footer></main></div></div>${state.screen==="sector"?`<div class="hpSectorShade" data-hpa="closeSector"><aside class="hpSectorDrawer" role="dialog" aria-modal="true" aria-label="Ficha detalhada do setor"><div class="hpSectorDrawerTop"><b>Ficha completa do setor</b><button class="hpClose" type="button" data-hpa="closeSector" aria-label="Fechar ficha">✕ Fechar</button></div><div class="hpSectorDrawerBody">${renderSector()}</div></aside></div>`:""}`;
}
function render(){
 if(!root) return;
 root.innerHTML=layout();
 document.body.classList.add("hp-open");
 root.querySelector("#hpSearch")?.addEventListener("input",e=>{
  const s=e.target.selectionStart;state.search=e.target.value;
  const q=state.search;render();const n=root.querySelector("#hpSearch");if(n){n.focus();n.setSelectionRange(Math.min(s,q.length),Math.min(s,q.length));}
 });
 root.querySelector("#hpScenario")?.addEventListener("change",e=>{state.scenario=e.target.value;state.screen="sectors";render();});
 root.querySelector("#hpContactFilter")?.addEventListener("change",e=>{state.contact=e.target.value;render();});
}
function open(screen="sectors",sector=null,person=null,scenario=null){
 if(!root){root=document.createElement("div");root.id="hpRoot";root.className="hpOverlay";document.body.appendChild(root);root.addEventListener("click",click);root.addEventListener("submit",submit);}
 if(scenario)state.scenario=scenario;
 state.screen=screen;state.sector=sector;state.person=person;state.reveal=false;state.replace=false;state.editForm=null;
 render();
}
function close(){document.body.classList.remove("hp-open");if(root)root.remove();root=null;state.replace=false;state.editForm=null;}
function nav(screen){state.screen=screen;state.search="";state.replace=false;state.editForm=null;render();}
function bindNav(){
 if(!document.getElementById("hpNavEntry")){
  const list=document.querySelector(".navList");
  if(list){const b=document.createElement("button");b.className="navBtn";b.type="button";b.id="hpNavEntry";b.innerHTML='<span class="hpNavIcon">◷</span><span>Equipe e histórico</span><span class="navBadge" id="hpNavCount">0</span>';b.onclick=()=>open("sectors");list.appendChild(b);}
 }
 const count=document.getElementById("hpNavCount");if(count)count.textContent=String(state.occupancies.filter(x=>x.scenario_code==="C2"&&!x.end_date).length);
 if(!window.__haraldPeopleClicks){
  window.__haraldPeopleClicks=true;
  document.addEventListener("click",e=>{
   if(document.body.classList.contains("auth-locked"))return;
   const storeTrigger=e.target.closest("[data-hp-store]");
   if(storeTrigger){e.preventDefault();e.stopImmediatePropagation();state.store=storeTrigger.dataset.hpStore;open("store",null,null,storeTrigger.dataset.hpScenario||null);return;}
   const target=e.target.closest("[data-edit-person]");
   if(target){e.preventDefault();e.stopImmediatePropagation();open("sector",target.dataset.editPerson);return;}
   const card=e.target.closest("[data-save-person]");
   if(card){e.preventDefault();e.stopImmediatePropagation();open("sector",card.dataset.savePerson);return;}
  },true);
  const obs=new MutationObserver(()=>{
    document.querySelectorAll(".teamCard:not([data-hp-enhanced])").forEach(c=>{
      c.dataset.hpEnhanced="1";
      const label=c.querySelector(".teamName")?.textContent?.trim();
      if(!label)return;
      const action=document.createElement("button");action.className="hpInlineAction";action.type="button";action.textContent="Ficha, histórico e substituições →";action.onclick=()=>open("sector",label);c.appendChild(action);
    });
  });
  const cont=document.getElementById("content");if(cont)obs.observe(cont,{childList:true,subtree:false});
 }
}
async function click(e){
 const btn=e.target.closest("[data-hpa]");if(!btn)return;
 const action=btn.dataset.hpa;
 if(action==="close")return close();
 if(action==="closeSector"){if(btn.classList.contains("hpSectorShade")&&e.target!==btn)return;return nav("sectors");}
 if(action==="back")return nav("sectors");
 if(action==="nav")return nav(btn.dataset.id);
 if(action==="filter"){state.filter=btn.dataset.id;return render();}
 if(action==="openSector"){return open("sector",btn.dataset.sector,null,btn.dataset.scenario||null);}
 if(action==="openPerson"){return open("person",null,btn.dataset.id);}
 if(action==="openStore"){state.store=btn.dataset.id;return open("store",null,null,btn.dataset.scenario||null);}
 if(action==="replace"){state.replace=true;return render();}
 if(action==="cancelReplace"){state.replace=false;return render();}
 if(action==="editPerson"){state.editForm="public";return render();}
 if(action==="editPrivate"){state.editForm="private";return render();}
 if(action==="cancelEdit"){state.editForm=null;return render();}
 if(action==="reveal"){state.reveal=!state.reveal;return render();}
 if(action==="whatsapp"){
  const p=pby(state.person);const n=(p?.whatsapp||"").replace(/\D/g,"");if(n.length<10)return alert("Telefone não cadastrado.");
  const phone=n.startsWith("55")?n:"55"+n;const sector=occPerson(p.id)[0]?.sector_code||"";
  const msg=`Olá, ${p.full_name.split(" ")[0]}! Aqui é a coordenação HARALD. Precisamos alinhar o setor ${sector}.`;
  window.open("https://wa.me/"+phone+"?text="+encodeURIComponent(msg),"_blank","noopener,noreferrer");return;
 }
}
async function api(path,opts){if(!state.api)throw Error("Conexão não configurada");return state.api(path,opts);}
async function submit(e){
 const f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
 if(!okWrite())return alert("Seu perfil possui acesso somente para consulta.");
 const name=f.dataset.form,btn=f.querySelector('[type="submit"]');if(btn){btn.disabled=true;btn.textContent="Salvando...";}
 try{
  const d=Object.fromEntries(new FormData(f));
  if(name==="note"){
    const scenario=d.kind==="sector"?d.scenario||state.scenario:null;
    if(!d.body?.trim())throw Error("A anotação não pode ficar vazia.");
    await api("harald_notes?on_conflict=target_type,target_key,scenario_code",{method:"POST",body:{target_type:d.kind,target_key:d.key,scenario_code:scenario,note_body:d.body.trim()},prefer:"resolution=merge-duplicates"});
  }
  if(name==="replace"){
   if(d.endDate&&d.startDate<=d.endDate)throw Error("A nova admissão deve ser posterior à saída anterior.");
   if(!d.reason||d.reason.trim().length<5)throw Error("Descreva a justificativa.");
   await api("rpc/harald_replace_promoter",{method:"POST",body:{p_scenario_code:state.scenario,p_sector_code:state.sector,p_start_date:d.startDate,p_end_date_previous:d.endDate||null,p_reason:d.reason.trim(),p_full_name:d.name.trim(),p_phone:d.phone.trim()||null,p_existing_promoter_id:null},prefer:"return=representation"});
   state.replace=false;
  }
  if(name==="editPerson"){
   const p=pby(state.person);const payload={status:d.status,profile:d.profile?.trim()||null,registration_number:d.registration_number?.trim()||null,whatsapp:d.whatsapp?.trim()||null,transport_mode:d.transport_mode||null,vehicle_type:d.vehicle_type?.trim()||null,mob2:d.mob2||null,admission_date:d.admission_date||null,weekly_schedule:d.weekly_schedule?.trim()||null,coordinator_name:d.coordinator_name?.trim()||null,geniale_manager:d.geniale_manager?.trim()||null,hiring_type:d.hiring_type||null};
   await api("harald_promoters?id=eq."+encodeURIComponent(p.id),{method:"PATCH",body:payload});
   state.editForm=null;
  }
  if(name==="editPrivate"){
   if(state.role!=="admin")throw Error("Somente administradores podem alterar dados pessoais.");
   const fields=["rg","birth_date","personal_email","personal_phone","street","street_number","complement","neighborhood","city","state_code","postal_code","salary","meal_allowance","food_allowance","first_due_day","second_due_day","first_due_reference","second_due_reference"];
   const payload=Object.fromEntries(fields.map(k=>[k,["salary","meal_allowance","food_allowance"].includes(k)?(d[k]!==""&&d[k]!=null?Number(d[k]):null):(d[k]?.trim()||null)]));
   if(privateBy(state.person)){await api("harald_promoter_private?promoter_id=eq."+encodeURIComponent(state.person),{method:"PATCH",body:payload});}
   else{const cpf=String(d.cpf||"").replace(/\D/g,"");if(cpf.length!==11)throw Error("CPF precisa ter 11 números.");await api("harald_promoter_private",{method:"POST",body:{...payload,cpf, promoter_id:state.person}});}
   state.editForm=null;state.reveal=false;
  }
  if(window.haraldCloud?.reload)await window.haraldCloud.reload();else render();
  const ok=document.createElement("div");ok.className="hpToast";ok.textContent="Registro salvo e histórico preservado";document.body.appendChild(ok);setTimeout(()=>ok.remove(),3000);
 }catch(err){alert("Não foi possível salvar.\n"+(err.message||err));if(btn){btn.disabled=false;btn.textContent="Tentar novamente";}}
}
function hydrate(payload){
 state.people=payload.persons||[];state.occupancies=payload.occupancies||[];state.timeline=payload.timeline||[];state.notes=payload.notes||[];state.privateRows=payload.privateRows||[];state.sectors=payload.teams||[];state.stores=payload.stores||[];state.role=payload.role||"viewer";state.api=payload.api;
 bindNav();if(root)render();
}
function reset(){
 close();state.people=[];state.occupancies=[];state.timeline=[];state.notes=[];state.privateRows=[];state.api=null;
 document.getElementById("hpNavEntry")?.remove();
}
window.haraldPeople={hydrate,reset,open,openSector:(sector,scenario)=>open("sector",sector,null,scenario||"C2"),openPerson:id=>open("person",null,id),openStore:(storeId,scenario)=>{state.store=storeId;open("store",null,null,scenario||"C2");}};
})();