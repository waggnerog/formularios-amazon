(function dashboardModule() {
"use strict";
const GROUPS=[
 {key:"FULLTIME",name:"Fulltime (CLT)",accent:"full"},
 {key:"PARTTIME",name:"Parttime (CLT)",accent:"part"},
 {key:"HORISTA",name:"Horistas",accent:"hora"}
];
const REGIONS={
 "Norte":["AC","AP","AM","PA","RO","RR","TO"],
 "Nordeste":["AL","BA","CE","MA","PB","PE","PI","RN","SE"],
 "Centro-Oeste":["DF","GO","MT","MS"],
 "Sudeste":["ES","MG","RJ","SP"],
 "Sul":["PR","RS","SC"]
};
const UF_REGIONS={};
Object.entries(REGIONS).forEach(([r,ufs])=>ufs.forEach(uf=>UF_REGIONS[uf]=r));
const UF_NAMES={
 AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",
 ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MT:"Mato Grosso",MS:"Mato Grosso do Sul",
 MG:"Minas Gerais",PA:"Pará",PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",
 RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
 RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins"
};
const STATUS={
 active:{label:"ATIVO",cls:"active"},
 open:{label:"VAGA OPEN",cls:"open"}
};
const st={geo:null,geoError:false,gettingGeo:false,week:"AVG",region:null,uf:null,coverageFilter:"all",detailTab:"sectors",data:null,ctx:null};
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nfmt=(n,decimal=0)=>Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:decimal,maximumFractionDigits:decimal});
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function hasPhone(p){const d=String(p?.whatsapp||"").replace(/\D/g,"");return d.length===10||d.length===11||(d.startsWith("55")&&(d.length===12||d.length===13));}
function key(sc,sector){return `${sc}|${sector}`;}
function getMaps(){
 const d=st.data||{},sc=st.ctx?.scenario||"C2";
 const persons=new Map((d.persons||[]).map(p=>[p.id,p]));
 const assigns=new Map((d.occupancies||[]).filter(x=>x.scenario_code===sc&&!x.end_date).map(x=>[x.sector_code,x]));
 const statuses=new Map((d.sectorStatuses||[]).filter(x=>x.scenario_code===sc).map(x=>[x.sector_code,x]));
 const candidates=new Map();
 for(const c of (d.sectorCandidates||[]).filter(x=>x.scenario_code===sc&&x.active_source_record!==false)){
  if(!candidates.has(c.sector_code))candidates.set(c.sector_code,[]);
  candidates.get(c.sector_code).push(c);
 }
 const stores=new Map((d.stores||[]).filter(x=>x.sc===sc).map(x=>[String(x.src),x]));
 return {persons,assigns,statuses,candidates,stores};
}
function scopedTeams(ufSet=null){
 const c=st.ctx;if(!c)return[];
 return c.teams.filter(t=>!ufSet||ufSet.has(t.uf));
}
function scopedStores(ufSet=null){
 const c=st.ctx;if(!c)return[];
 return c.stores.filter(x=>!ufSet||ufSet.has(x.uf));
}
function countDistinctStores(list){return new Set(list.map(s=>String(s.src??s.id))).size;}
function activeInfo(team,maps){
 const link=maps.assigns.get(team.sector);if(!link)return null;
 const person=maps.persons.get(link.promoter_id);
 if(!person)return null;
 // O vínculo oficial define ocupação; status cadastral e data não removem o promotor do mapa.
 return {person,link,isActive:true,isUpcoming:false};
}
function availableActuals(sc,week,allowedSectorCodes,ufSet,maps){
 const dataset=st.data||{},imports=dataset.actualImports||[];
 const weeks=week==="AVG"?[1,2]:[Number(week)];
 const parts=weeks.map(w=>{
   const info=imports.filter(x=>x.scenario_code===sc&&Number(x.cycle_week)===w)
     .sort((a,b)=>String(b.uploaded_at).localeCompare(String(a.uploaded_at)))[0];
   if(!info)return null;
   const rows=(dataset.actualVisits||[]).filter(x=>x.scenario_code===sc&&Number(x.cycle_week)===w&&x.visit_date>=info.period_start&&x.visit_date<=info.period_end&&x.result==="realized"&&allowedSectorCodes.has(x.sector_code)&&(!ufSet||ufSet.has(maps.stores.get(String(x.store_key))?.uf)));
   return {n:rows.length,complete:info.coverage_status==="complete"};
 });
 if(parts.every(x=>!x))return {n:null,mode:"absent"};
 if(parts.some(x=>!x))return {n:parts.filter(Boolean).reduce((a,x)=>a+x.n,0),mode:"partial"};
 const n=parts.reduce((a,x)=>a+x.n,0)/parts.length;
 return {n,mode:parts.every(x=>x.complete)?"complete":"partial"};
}
function analyze({model=null,ufSet=null,activeOnly=false}={}){
 const ctx=st.ctx,maps=getMaps();
 const teams=scopedTeams(ufSet).filter(t=>!model||t.model===model);
 const sectors=new Set(teams.map(x=>x.sector));
 const fullSectors=scopedTeams().filter(t=>!model||t.model===model).map(t=>t.sector);
 const storeRows=scopedStores(ufSet).filter(s=>fullSectors.includes(s.sector));
 const peopleMap=new Map(),upcomingIds=new Set(),links=new Set();
 for(const t of teams){
  const info=activeInfo(t,maps);
  if(!info)continue;
  links.add(info.person.id);
  if(info.isUpcoming)upcomingIds.add(info.person.id);
  if(info.isActive)peopleMap.set(info.person.id,info.person);
 }
 const days=(st.data?.routeDays||[]).filter(x=>x.scenario_code===ctx.scenario&&x.scheduled!==false&&sectors.has(x.sector_code)&&(!ufSet||ufSet.has(maps.stores.get(String(x.store_key))?.uf)));
 const activeTeams=new Set(teams.filter(t=>activeInfo(t,maps)?.isActive).map(t=>t.sector));
 const selectCount=list=>{
  const w1=list.filter(x=>Number(x.cycle_week)===1).length,w2=list.filter(x=>Number(x.cycle_week)===2).length;
  return st.week==="1"?w1:st.week==="2"?w2:(w1+w2)/2;
 };
 const planned=selectCount(days),plannedAssigned=selectCount(days.filter(x=>activeTeams.has(x.sector_code)));
 const actual=availableActuals(ctx.scenario,st.week,sectors,ufSet,maps);
 const assignedActual=availableActuals(ctx.scenario,st.week,activeTeams,ufSet,maps);
 const filledSectors=teams.filter(t=>maps.assigns.has(t.sector)).length;
 const missing=0,filledOpen=0;
 const byStatus={active:filledSectors,open:teams.length-filledSectors};
 return {filledSectors,filledOpen,sectors:teams.length,stores:countDistinctStores(storeRows),links:links.size,active:peopleMap.size,upcoming:upcomingIds.size,people:[...peopleMap.values()],planned,plannedAssigned,plannedAverage:peopleMap.size?plannedAssigned/peopleMap.size:null,actual,actualAverage:assignedActual.n!==null&&peopleMap.size?assignedActual.n/peopleMap.size:null,statuses:byStatus,missing,teams};
}
function summaryMetric(label,value,help,accent=""){
 return `<article class="hdTopMetric ${accent}"><div class="hdTopMetricLabel">${esc(label)}</div><strong>${esc(value)}</strong><small>${esc(help)}</small></article>`;
}
function actualLabel(actual,average=false){
 if(actual.n===null)return `<span class="hdAwait">Aguardando dados</span>`;
 return `<strong>${nfmt(actual.n,average?1:(st.week==="AVG"?1:0))}</strong>${actual.mode==="partial"?'<span class="hdPartial">Parcial</span>':""}`;
}
function typeTable(){
 const all=analyze();
 return `<section class="hdCard"><div class="hdCardHead"><div><span class="hdEyebrow">ABERTURA POR TIPO DE EQUIPE</span><h2>Indicadores separados por modelo</h2></div><span class="hdHint">Planejado por roteiro · Realizado por base de execução</span></div>
 <div class="hdTableScroll"><table class="hdTable"><thead><tr><th>Equipe</th><th>Setores</th><th>Lojas</th><th>Promotores ativos*</th><th>Visitas programadas / semana</th><th>Média programada / ativo</th><th>Realizadas</th><th>Média realizada / ativo</th></tr></thead><tbody>
 ${GROUPS.map(m=>{const x=analyze({model:m.key});return `<tr><th><span class="hdGroupMark ${m.accent}"></span>${esc(m.name)}</th><td>${nfmt(x.sectors)}</td><td>${nfmt(x.stores)}</td><td><b>${nfmt(x.active)}</b> <small>/${nfmt(x.links)} vinculados</small></td><td><strong>${nfmt(x.planned,st.week==="AVG"?1:0)}</strong></td><td>${x.plannedAverage!==null?nfmt(x.plannedAverage,1):'<span class="hdNoValue">—</span>'}</td><td>${actualLabel(x.actual)}</td><td>${x.actualAverage!==null?`${nfmt(x.actualAverage,1)}${x.actual.mode==="partial"?'<small> parcial</small>':""}`:'<span class="hdNoValue">—</span>'}</td></tr>`}).join("")}
 <tr class="hdTableTotal"><th>Projeto</th><td>${nfmt(all.sectors)}</td><td>${nfmt(all.stores)}</td><td><b>${nfmt(all.active)}</b> <small>/${nfmt(all.links)} vinculados</small></td><td><strong>${nfmt(all.planned,st.week==="AVG"?1:0)}</strong></td><td>${all.plannedAverage!==null?nfmt(all.plannedAverage,1):"—"}</td><td>${actualLabel(all.actual)}</td><td>${all.actualAverage!==null?nfmt(all.actualAverage,1):"—"}</td></tr>
 </tbody></table></div>
 <p class="hdTableFoot">*Ativos = cadastro com status ATIVO e data de início atingida, sem confirmação de presença em campo. As médias por ativo (programada e realizada) consideram <b>somente as visitas dos setores desses profissionais</b>. Setores ainda sem cadastro entram no total planejado, mas não na média por promotor. As duas semanas formam um ciclo de planejamento, não duas operações para somar.</p></section>`;
}
function sourceContract(key){
 return (st.data?.sourceContracts||[]).find(x=>x.source_key===key)||null;
}
function horistaVisuals(){
 const h=analyze({model:"HORISTA"});
 const total=h.sectors||0,filled=h.filledSectors||0,unfilled=Math.max(0,total-filled);
 const active=filled,open=unfilled;
 const pct=n=>total?Math.max(0,Math.min(100,(n/total)*100)):0;
 const pFilled=pct(filled);
 const donut=`background:conic-gradient(#5aa991 0 ${pFilled.toFixed(2)}%,#e8edf5 ${pFilled.toFixed(2)}% 100%)`;
 const regions=Object.entries(REGIONS).map(([name,ufs])=>{
   const x=analyze({model:"HORISTA",ufSet:new Set(ufs)});
   return {name,total:x.sectors,filled:x.filledSectors||0};
 }).sort((x,y)=>y.total-x.total);
 const maxRegion=Math.max(1,...regions.map(x=>x.total));
 const source=st.data?.sourceState||{};
 const sourceLabel=source.file_name||"Controle Operacional Horistas.xlsx";
 const processed=source.processed_at?new Date(source.processed_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"Aguardando publicação";
 return `<section class="hdCard hdHoristaCard" aria-labelledby="hdHoristaTitle">
 <div class="hdCardHead hdHoristaHead"><div><span class="hdEyebrow">02 · COBERTURA HORISTA</span><h2 id="hdHoristaTitle">Vagas Horistas</h2><p>Preenchimento definido pela existência de promotor vinculado ao setor na fonte oficial.</p></div><div class="hdSourceLink hdSourceStatic"><span>FONTE OFICIAL · CHAT CONTROLE OPERACIONAL</span><b>${esc(sourceLabel)}</b><small>Aba Controle Operacional · publicada ${esc(processed)}</small></div></div>
 <div class="hdHoristaGrid">
   <div class="hdDonutPanel">
     <div class="hdDonutWrap"><div class="hdDonut" style="${donut}" role="img" aria-label="${nfmt(filled)} de ${nfmt(total)} vagas Horistas preenchidas"><div class="hdDonutCenter"><strong>${nfmt(total)}</strong><span>vagas</span></div></div></div>
     <div class="hdDonutPrimary"><span>Preenchidas</span><strong>${nfmt(filled)}</strong><small>${nfmt(pFilled,1)}% do total</small></div>
     <div class="hdLegendGrid">
       <div><i class="filled"></i><span>Com promotor</span><b>${nfmt(filled)}</b></div>
       <div><i class="pending"></i><span>Vaga Open</span><b>${nfmt(unfilled)}</b></div>
     </div>
   </div>
   <div class="hdHoristaStatus">
     <div class="hdMiniKpis">
       <div><span>Total de vagas</span><strong>${nfmt(total)}</strong><small>Setores Horistas</small></div>
       <div><span>ATIVO</span><strong>${nfmt(filled)}</strong><small>Setores com promotor</small></div>
       <div><span>VAGA OPEN</span><strong>${nfmt(unfilled)}</strong><small>Setores sem promotor</small></div>
       <div><span>Promotores únicos</span><strong>${nfmt(h.links)}</strong><small>Pessoas na fonte</small></div>
     </div>
     <div class="hdStatusFlow" aria-label="Status das vagas por vínculo">
       ${[["ATIVO",active,"active"],["VAGA OPEN",open,"open"]].map(([label,value,cls])=>`<div class="hdFlowRow"><span>${label}</span><div class="hdFlowTrack"><i class="${cls}" style="width:${pct(value).toFixed(2)}%"></i></div><b>${nfmt(value)}</b></div>`).join("")}
     </div>
   </div>
 </div>
 <div class="hdRegionBars"><div class="hdRegionBarsHead"><div><b>Distribuição por região</b><span>Barra = vagas por região · verde = setores com promotor</span></div><small>${nfmt(total)} vagas no Brasil</small></div>
 ${regions.map(r=>`<div class="hdRegionBarRow"><span class="hdRegionName">${esc(r.name)}</span><div class="hdRegionTrack" title="${nfmt(r.filled)} preenchidas de ${nfmt(r.total)}"><i class="capacity" style="width:${Math.max(1,r.total/maxRegion*100)}%"><em class="filled" style="width:${r.total?r.filled/r.total*100:0}%"></em></i></div><span class="hdRegionValue"><b>${nfmt(r.total)}</b><small>${nfmt(r.filled)} preenchidas</small></span></div>`).join("")}
 </div>
 <div class="hdHoristaNote"><b>Regra de exibição:</b> ATIVO quando o setor tem promotor vinculado; VAGA OPEN quando não tem. O histórico de status da planilha permanece preservado na fonte.</div>
 </section>`;
}
function statusCard(){
 const x=analyze();
 return `<section class="hdCard"><div class="hdCardHead"><div><span class="hdEyebrow">STATUS DA OPERAÇÃO</span><h2>Ocupação das vagas</h2><p>Calculada pelo vínculo PROMOTOR ↔ SETOR na fonte oficial.</p></div></div>
 <div class="hdStatusTiles hdSimpleStatusTiles">
 <div class="hdStatusTile"><span class="hdStatusDot active"></span><span>ATIVO · com promotor</span><strong>${nfmt(x.statuses.active)}</strong></div>
 <div class="hdStatusTile"><span class="hdStatusDot open"></span><span>VAGA OPEN · sem promotor</span><strong>${nfmt(x.statuses.open)}</strong></div>
 </div></section>`;
}
function geographicSet(){
 return st.uf?new Set([st.uf]):st.region?new Set(REGIONS[st.region]):null;
}
function projectMapTitle(){
 return st.uf?`${UF_NAMES[st.uf]} (${st.uf})`:st.region||"Brasil";
}
function geographyDetails(){
 const set=geographicSet(),m=analyze({ufSet:set}),maps=getMaps();
 const mode=st.uf?"uf":st.region?"region":"national";
 const allRows=st.uf?m.teams.slice().sort((a,b)=>String(a.sector).localeCompare(String(b.sector),"pt-BR")):[];
 const matchesCoverage=sector=>st.coverageFilter==="all"||(st.coverageFilter==="active"?maps.assigns.has(sector):!maps.assigns.has(sector));
 const rows=allRows.filter(team=>matchesCoverage(team.sector));
 const storeRows=(st.uf?scopedStores(new Set([st.uf])):[]).filter(store=>matchesCoverage(store.sector)).sort((a,b)=>String(a.n).localeCompare(String(b.n),"pt-BR"));
 const personRows=rows.map(team=>({team,who:activeInfo(team,maps)})).filter(x=>x.who);
 const peopleIds=new Set(personRows.map(x=>x.who.person.id));
 const allAreas=mode==="region"?REGIONS[st.region]:Object.keys(REGIONS);
 const areaList=mode==="uf"?[]:mode==="national"?allAreas.map(region=>({title:region,id:region,level:"region",...analyze({ufSet:new Set(REGIONS[region])})})):
 allAreas.map(uf=>({title:UF_NAMES[uf],id:uf,level:"uf",...analyze({ufSet:new Set([uf])})}));
 const sectorList=rows.map(team=>{
  const p=activeInfo(team,maps)?.person,status=p?"active":"open";
  const owner=p?.full_name||"Sem promotor · vaga aberta";
  return `<button type="button" data-hd-sector="${esc(team.sector)}" class="hdMapSector hdDetailRow" aria-label="Abrir setor ${esc(team.sector)}"><span class="hdRowIcon">▦</span><span class="hdDetailRowText"><b>${esc(team.sector)}</b><small>${esc(team.model==="HORISTA"?"Horista":team.model==="PARTTIME"?"Parttime":"Fulltime")} · ${esc(team.cities||team.uf||"")} · ${nfmt(team.pdvs)} loja(s)</small><small>${esc(owner)}</small></span><span class="hdSectorStatus ${esc(status||"unknown")}">${esc(STATUS[status]?.label||"Status pendente")}</span><span class="hdChevron" aria-hidden="true">›</span></button>`;
 }).join("");
 const storeList=storeRows.map(store=>{
  const assigned=maps.assigns.has(store.sector),status=assigned?"active":"open";
  return `<button type="button" data-hd-store="${esc(store.id)}" class="hdMapSector hdDetailRow" aria-label="Abrir loja ${esc(store.n)}"><span class="hdRowIcon">⌂</span><span class="hdDetailRowText"><b>${esc(store.n)}</b><small>${esc(store.city||"")} · ${esc(store.sector)}</small></span><span class="hdSectorStatus ${status}">${STATUS[status].label}</span><span class="hdChevron" aria-hidden="true">›</span></button>`;
 }).join("");
 const uniquePeople=[...new Map(personRows.map(v=>[v.who.person.id,v])).values()];
 const peopleList=uniquePeople.map(({team,who})=>`<button type="button" data-hd-person="${esc(who.person.id)}" class="hdMapPerson hdDetailRow" aria-label="Abrir ficha de ${esc(who.person.full_name)}"><span class="hdPersonAvatar">${esc((who.person.full_name||"?").split(/\s+/).slice(0,2).map(v=>v[0]).join("").toUpperCase())}</span><span class="hdDetailRowText"><b>${esc(who.person.full_name)}</b><small>${esc(team.sector)} · ${esc(who.isUpcoming?"Início previsto":who.isActive?"Ativo cadastral":"Status a confirmar")}</small></span><span class="hdChevron" aria-hidden="true">›</span></button>`).join("");
 const areaRows=areaList.map(v=>{
  const count=v.sectors,active=v.active;
  return `<button type="button" class="hdAreaRow hdDetailRow" data-hd-${v.level}="${esc(v.id)}" aria-label="${esc(v.title)}: ${nfmt(count)} setores"><span class="hdAreaAvatar">${v.level==="uf"?esc(v.id):"◉"}</span><span class="hdDetailRowText"><b>${esc(v.title)}</b><small>${nfmt(v.stores)} lojas · ${nfmt(v.filledSectors)} ativos · ${nfmt(v.sectors-v.filledSectors)} vagas abertas</small></span><span class="hdAreaSectorTotal"><b>${nfmt(count)}</b><small>setores</small></span><span class="hdChevron" aria-hidden="true">›</span></button>`;
 }).join("");
 const sectionTitle=mode==="national"?"Explore por região":mode==="region"?"Estados desta região":st.detailTab==="people"?"Promotores vinculados":st.detailTab==="stores"?"Lojas do estado":"Setores do estado";
 let listHtml=mode==="uf"?(st.detailTab==="people"?peopleList:st.detailTab==="stores"?storeList:sectorList):areaRows;
 const listSize=mode==="uf"?(st.detailTab==="people"?uniquePeople.length:st.detailTab==="stores"?storeRows.length:rows.length):areaRows.length;
 const tabHeader=mode==="uf"?`<div class="hdDetailTabs" role="group" aria-label="Detalhar por setores, lojas ou promotores"><button data-hd-tab="sectors" aria-pressed="${st.detailTab==="sectors"}" class="${st.detailTab==="sectors"?"active":""}">Setores <span>${nfmt(rows.length)}</span></button><button data-hd-tab="stores" aria-pressed="${st.detailTab==="stores"}" class="${st.detailTab==="stores"?"active":""}">Lojas <span>${nfmt(storeRows.length)}</span></button><button data-hd-tab="people" aria-pressed="${st.detailTab==="people"}" class="${st.detailTab==="people"?"active":""}">Promotores <span>${nfmt(peopleIds.size)}</span></button></div>`:"";
 const coverageToolbar=mode==="uf"?`<div class="hdCoverageFilters" role="group" aria-label="Filtrar cobertura da operação">${[["all","Todos"],["active","ATIVO"],["open","VAGA OPEN"]].map(([value,label])=>`<button data-hd-coverage="${value}" aria-pressed="${st.coverageFilter===value}" class="${st.coverageFilter===value?"selected":""}">${label}</button>`).join("")}</div>`:"";
 const empty=mode==="uf"?(st.detailTab==="people"?"Nenhum promotor vinculado neste estado.":"Nenhum setor programado neste estado."):"Nenhum resultado.";
 return `<aside class="hdMapDetail" aria-label="Detalhes territoriais da operação">
 <div class="hdDetailFixed">
 <div class="hdScopeTitle"><span class="hdEyebrow">${mode==="national"?"PANORAMA NACIONAL":mode==="region"?"PANORAMA REGIONAL":"EXPLORAÇÃO POR UF"}</span><div class="hdScopeHeading"><h3>${esc(projectMapTitle())}</h3>${st.uf?'<button type="button" class="hdBackLink" data-hd-clear-uf>← Região</button>':st.region?'<button type="button" class="hdBackLink" data-hd-clear-region>← Brasil</button>':""}</div><p>${mode==="national"?"Clique em uma região ou estado no mapa":mode==="uf"?esc(UF_REGIONS[st.uf]):"Clique em um estado no mapa"}</p></div>
 <div class="hdScopeKpis" aria-label="Indicadores do local selecionado"><div><strong>${nfmt(m.sectors)}</strong><span>Setores</span></div><div><strong>${nfmt(m.filledSectors)}</strong><span>ATIVO</span></div><div><strong>${nfmt(m.sectors-m.filledSectors)}</strong><span>VAGA OPEN</span></div><div><strong>${nfmt(m.stores)}</strong><span>Lojas</span></div></div>
 ${coverageToolbar}
 ${tabHeader}
 ${mode==="uf"?`<div class="hdDetailSearch"><span aria-hidden="true">⌕</span><input id="hdScopeSearch" type="search" placeholder="Buscar loja, setor, cidade ou promotor" aria-label="Pesquisar nesta lista" autocomplete="off"/><small id="hdResultsCount">${nfmt(listSize)} registros</small></div>`:""}
 <div class="hdMapSubhead"><span>${esc(sectionTitle)}</span><span>${nfmt(listSize)}</span></div>
 </div>
 <div class="hdDetailScroll" tabindex="0" role="region" aria-label="${esc(sectionTitle)}; lista rolável"><div class="hdMapDetailList">${listHtml||`<p class="hdEmpty">${empty}</p>`}</div></div>
 <div class="hdDetailFooter">${mode==="uf"?"Selecione uma linha para abrir a ficha completa e seu histórico.":"Selecione uma área para ver seus setores e responsáveis."}</div>
 </aside>`;
}
function coordinates(geometry){
 const pol=geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
 return pol;
}
function geoPaths(){
 if(!st.geo)return `<div class="hdMapLoading">${st.geoError?"Não foi possível abrir a malha. Explore as regiões e estados na lista ao lado.":"Carregando os 27 estados brasileiros…"}</div>`;
 const all=st.geo.features;
 const sectorCounts=new Map(),maps=getMaps();
 for(const team of scopedTeams()){
  const count=sectorCounts.get(team.uf)||{total:0,filled:0};count.total++;
  if(maps.assigns.has(team.sector))count.filled++;
  sectorCounts.set(team.uf,count);
 }
 const flat=all.flatMap(f=>coordinates(f.geometry).flatMap(poly=>poly.flat()));
 const minX=Math.min(...flat.map(p=>p[0])),maxX=Math.max(...flat.map(p=>p[0])),minY=Math.min(...flat.map(p=>p[1])),maxY=Math.max(...flat.map(p=>p[1]));
 const w=600,h=620,pad=30,scale=Math.min((w-2*pad)/(maxX-minX),(h-2*pad)/(maxY-minY));
 const x=lng=>pad+(lng-minX)*scale+(w-2*pad-(maxX-minX)*scale)/2;
 const y=lat=>pad+(maxY-lat)*scale+(h-2*pad-(maxY-minY)*scale)/2;
 const labels=[];
 const callouts={
   RN:{x:600,y:175},PB:{x:600,y:202},PE:{x:600,y:229},AL:{x:600,y:256},SE:{x:600,y:283},
   DF:{x:393,y:310},ES:{x:531,y:383},RJ:{x:526,y:431}
 };
 const shapes=all.map(f=>{
   const uf=f.properties.sigla;if(!UF_REGIONS[uf])return "";
   const polygons=coordinates(f.geometry),coordinatesFlat=polygons.flatMap(poly=>poly.flat());
   const xs=coordinatesFlat.map(p=>x(p[0])),ys=coordinatesFlat.map(p=>y(p[1]));
   const anchorX=(Math.min(...xs)+Math.max(...xs))/2,anchorY=(Math.min(...ys)+Math.max(...ys))/2;
   const d=polygons.map(poly=>poly.map(ring=>ring.map(([lon,lat],i)=>`${i===0?"M":"L"}${x(lon).toFixed(1)} ${y(lat).toFixed(1)}`).join(" ")+" Z").join(" ")).join(" ");
   const {total:count=0,filled=0}=sectorCounts.get(uf)||{};const open=count-filled;
   const region=UF_REGIONS[uf],selected=st.uf===uf?"selected":!st.uf&&st.region===region?"regionSelected":"";
   const dimmed=st.region&&region!==st.region?"dimmed":"";
   const coverage=count===0?"zero":filled===0?"allOpen":open===0?"allActive":"mixed";
   const outside=!!callouts[uf],px=outside?callouts[uf].x:anchorX,py=outside?callouts[uf].y:anchorY;
   const badgeW=47+(String(filled).length+String(count).length)*7,badgeH=21;
   const badgeX=px-badgeW/2, badgeY=py-badgeH/2;
   const leader=outside?`<path class="hdMapLeader" d="M ${anchorX.toFixed(1)} ${anchorY.toFixed(1)} L ${px.toFixed(1)} ${py.toFixed(1)}" />`:"";
   labels.push(`${leader}<g class="hdMapLabel ${outside?"hdMapLabelOutside":""} ${st.uf===uf?"selected":""} ${dimmed} ${count===0?"empty":""}" data-hd-map-uf="${uf}" aria-label="${esc(UF_NAMES[uf])}: ${nfmt(filled)} setores ativos de ${nfmt(count)}; ${nfmt(open)} vagas abertas" role="button" tabindex="0"><title>${esc(UF_NAMES[uf])} · ${nfmt(filled)} ativos / ${nfmt(count)} setores · ${nfmt(open)} vagas abertas</title><rect class="hdMapLabelHit" x="${(badgeX-4).toFixed(1)}" y="${(badgeY-8).toFixed(1)}" width="${badgeW+8}" height="${badgeH+16}" rx="10"/><rect x="${badgeX.toFixed(1)}" y="${badgeY.toFixed(1)}" width="${badgeW}" height="${badgeH}" rx="7"/><text x="${px.toFixed(1)}" y="${(py+3.5).toFixed(1)}" text-anchor="middle">${uf} <tspan class="hdMapLabelNum">${filled}/${count}</tspan></text></g>`);
   return `<path class="hdMapUF ${selected} ${dimmed} ${coverage}" d="${d}" data-hd-map-uf="${uf}" role="button" tabindex="0" aria-label="${esc(UF_NAMES[uf])}: ${nfmt(filled)} setores ativos de ${nfmt(count)}, ${nfmt(open)} vagas abertas"><title>${esc(UF_NAMES[uf])} · ${nfmt(filled)} ativos / ${nfmt(count)} setores · ${nfmt(open)} vagas abertas</title></path>`;
 }).join("");
 return `<svg id="hdBrazilSVG" class="hdBrazilSVG" viewBox="0 0 690 620" role="group" aria-label="Mapa interativo do Brasil com setores ativos e vagas abertas por estado">${shapes}<g class="hdMapLabels">${labels.join("")}</g></svg>`;
}
function brazilMap(){
 return `<section class="hdCard hdMapCard" aria-labelledby="hdMapTitle">
 <div class="hdCardHead hdMapCardHeader"><div><span class="hdEyebrow">01 · PRIMEIRO, ONDE ESTAMOS?</span><h2 id="hdMapTitle">Mapa da operação</h2><p>Cada estado mostra <b>ATIVO / TOTAL DE SETORES</b>. Selecione a UF para ver as vagas abertas e as lojas relacionadas.</p></div><div class="hdMapKey"><span class="hdMapKeyDot"></span><span><b>26 estados + DF</b><small>Explore por território</small></span></div></div>
 <div class="hdRegionChips" role="group" aria-label="Selecionar região brasileira"><button data-hd-country aria-pressed="${!st.region&&!st.uf}" class="${!st.region&&!st.uf?"selected":""}">Brasil</button>${Object.keys(REGIONS).map(r=>`<button data-hd-region="${esc(r)}" aria-pressed="${st.region===r&&!st.uf}" class="${st.region===r?"selected":""}">${esc(r)}</button>`).join("")}</div>
 <div class="hdMapLayout"><div class="hdMapFigure"><div class="hdMapCanvas">${geoPaths()}</div><div class="hdMapLegend"><span><i class="allActive"></i> Todas ativas</span><span><i class="mixed"></i> Com promotor e vagas</span><span><i class="allOpen"></i> Só vagas abertas</span><span><i class="zero"></i> Sem setor</span></div><small class="hdGeoCredit">ATIVO / TOTAL · 1 setor pode atender várias lojas · limites estaduais do IBGE</small></div>${geographyDetails()}</div>
 </section>`;
}
function render({scenario,contract,stores,teams,saved}){
 st.ctx={scenario:"C2",contract:"HORISTA",stores,teams,saved};
 if(!st.data)return '<section class="hdCard"><h2>Preparando painel de gestão…</h2><p>Carregando a fonte oficial Horista publicada no Supabase.</p></section>';
 const x=analyze({model:"HORISTA"}),unfilled=Math.max(0,x.sectors-x.filledSectors);
 return `<div class="hdDashboard">
 ${brazilMap()}
 ${horistaVisuals()}
 <div class="hdSectionHeading"><div><span class="hdEyebrow">03 · RESUMO OPERACIONAL</span><h2>Indicadores Horistas</h2></div><p>Uma única fonte, sem mistura com CLT.</p></div>
 <div class="hdTopMetrics">
 ${summaryMetric("Lojas",nfmt(x.stores),"PDVs na aba Controle Operacional","stores")}
 ${summaryMetric("Vagas / setores",nfmt(x.sectors),"Setores Horistas únicos","sectors")}
 ${summaryMetric("Vagas preenchidas",nfmt(x.filledSectors),"Setores com PROMOTOR informado","people")}
 ${summaryMetric("Sem promotor",nfmt(unfilled),"Setores ainda sem vínculo","average")}
 ${summaryMetric("Promotores únicos",nfmt(x.links),"Pessoas vinculadas na fonte","people")}
 ${summaryMetric("Visitas programadas",nfmt(x.planned,st.week==="AVG"?1:0),"Programação semanal da fonte","visits")}
 </div>
 ${statusCard()}
 <div class="hdBottomNote"><b>Regra do Console:</b> ATIVO significa setor com PROMOTOR vinculado; VAGA OPEN significa setor sem PROMOTOR. O status original permanece preservado na fonte, e o Console não altera a planilha.</div></div>`;
}
function setRegion(r){
 if(!REGIONS[r])return;
 st.region=r;st.uf=null;st.coverageFilter="all";st.detailTab="sectors";refresh();
}
function setUf(uf){
 if(!UF_REGIONS[uf])return;
 st.uf=uf;st.region=UF_REGIONS[uf];st.coverageFilter="all";st.detailTab="sectors";refresh();
}
function refresh(){window.haraldApp?.refresh?.();}
function handleAction(el){
 if(el.hasAttribute("data-hd-tab")){if(["sectors","stores","people"].includes(el.dataset.hdTab)){st.detailTab=el.dataset.hdTab;refresh();}return true;}
 if(el.hasAttribute("data-hd-coverage")){const v=el.dataset.hdCoverage;if(["all","active","open"].includes(v)){st.coverageFilter=v;refresh();}return true;}
 if(el.hasAttribute("data-hd-week")){const v=el.dataset.hdWeek;if(["AVG","1","2"].includes(v)){st.week=v;refresh();}return true;}
 if(el.hasAttribute("data-hd-region")){setRegion(el.dataset.hdRegion);return true;}
 if(el.hasAttribute("data-hd-uf")){setUf(el.dataset.hdUf);return true;}
 if(el.hasAttribute("data-hd-country")){st.region=null;st.uf=null;refresh();return true;}
 if(el.hasAttribute("data-hd-clear-uf")){st.uf=null;refresh();return true;}
 if(el.hasAttribute("data-hd-clear-region")){st.region=null;st.uf=null;refresh();return true;}
 if(el.hasAttribute("data-hd-store")){window.haraldApp?.openStore?.(el.dataset.hdStore);return true;}
 if(el.hasAttribute("data-hd-sector")){window.haraldPeople?.openSector(el.dataset.hdSector,st.ctx?.scenario);return true;}
 if(el.hasAttribute("data-hd-person")){window.haraldPeople?.openPerson(el.dataset.hdPerson);return true;}
 if(el.hasAttribute("data-hd-refresh")){window.haraldCloud?.reload?.();return true;}
 return false;
}
function afterRender(){
 const scopeSearch=document.getElementById("hdScopeSearch");
 if(scopeSearch)scopeSearch.addEventListener("input",()=>{
   const normalize=v=>String(v||"").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
   const query=normalize(scopeSearch.value.trim());
   const rows=[...document.querySelectorAll(".hdMapDetailList > .hdDetailRow")];
   let visible=0;
   for(const row of rows){row.hidden=!!query&&!normalize(row.textContent).includes(query);if(!row.hidden)visible++;}
   const count=document.getElementById("hdResultsCount");if(count)count.textContent=visible+" resultado"+(visible===1?"":"s");
   const empty=document.getElementById("hdScopeSearchEmpty");
   if(empty)empty.hidden=visible!==0||!query;
   else if(!visible&&query){const item=document.createElement("p");item.id="hdScopeSearchEmpty";item.className="hdEmpty";item.textContent="Nenhum resultado nesta lista.";document.querySelector(".hdMapDetailList")?.appendChild(item);}
 });
 const svg=document.getElementById("hdBrazilSVG");if(!svg)return;
 const activate=el=>setUf(el.dataset.hdMapUf);
 svg.addEventListener("click",e=>{const el=e.target.closest("[data-hd-map-uf]");if(el)activate(el);});
 svg.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const el=e.target.closest("[data-hd-map-uf]");if(!el)return;e.preventDefault();activate(el);});
}
function loadMap(){
 if(st.geo||st.gettingGeo)return;
 st.gettingGeo=true;
 fetch("./brazil-states.geojson",{cache:"force-cache"}).then(async r=>{
   if(!r.ok)throw Error("Mapa indisponível");
   const j=await r.json();
   if(j.type!=="FeatureCollection"||j.features.length!==27)throw Error("Malha incompleta");
   st.geo=j;st.geoError=false;refresh();
 }).catch(e=>{console.error("HARALD map",e);st.geoError=true;refresh();}).finally(()=>{st.gettingGeo=false;});
}
function hydrate(d){
 st.data=d;loadMap();
}
window.haraldDashboard={hydrate,render,afterRender,handleAction,setWeek:week=>{if(["AVG","1","2"].includes(week)){st.week=week;refresh();}},getState:()=>({week:st.week,region:st.region,uf:st.uf,coverageFilter:st.coverageFilter})};
})();