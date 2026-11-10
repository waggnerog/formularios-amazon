import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src=readFileSync('harald/dashboard.js','utf8');
const states=JSON.parse(readFileSync('harald/brazil-states.geojson','utf8'));
const styles=readFileSync('harald/dashboard.css','utf8');
assert.ok(styles.includes('.hdMapLayout{display:grid;grid-template-columns:'),'Mapa deve ter colunas próprias');
assert.ok(styles.includes('height:645px;min-height:0'),'Mapa e detalhes devem manter altura fixa no desktop');
assert.ok(styles.includes('.hdDetailScroll{flex:1;min-height:0;overflow-y:auto'),'Lista deve rolar sem esticar o mapa');
assert.ok(styles.includes('.hdMapDetailList>.hdDetailRow[hidden]'),'Filtro visual de lista deve esconder resultados');
assert.equal(states.features.length,27,'Mapa precisa conter as 27 UFs brasileiras');
assert.equal(new Set(states.features.map(x=>x.properties.sigla)).size,27,'UFs duplicadas');
assert.ok(states.features.every(x=>['Polygon','MultiPolygon'].includes(x.geometry.type)));

new vm.Script(src,{filename:'dashboard.js'});
let refreshCount=0;
const scope={
 window:{haraldApp:{refresh:()=>refreshCount++}},
 fetch:async()=>({ok:true,json:async()=>states}),
 console,Date,Intl,Set,Map,Number,Math,Object,String,Array,JSON
};
vm.runInNewContext(src,scope);
const app=scope.window.haraldDashboard;
assert.equal(typeof app.render,'function');
const mkTeam=(sector,uf,model)=>({sc:'C2',sector,uf,model,modal:'KM',hours:40,pdvs:1,cities:uf,visits:3});
const teams=[
 mkTeam('GH2-SP-001','SP','FULLTIME'),
 mkTeam('GH2-RJ-001','RJ','PARTTIME'),
 mkTeam('GH2-BA-001','BA','HORISTA')
];
const mkStore=(src,sector,uf,model)=>({sc:'C2',src,sector,uf,model,id:src,n:'Loja teste'});
const stores=[
 mkStore('a','GH2-SP-001','SP','FULLTIME'),
 mkStore('b','GH2-RJ-001','RJ','PARTTIME'),
 mkStore('c','GH2-BA-001','BA','HORISTA')
];
const days=[
 ['GH2-SP-001','a',1,1],['GH2-SP-001','a',1,3],['GH2-RJ-001','b',1,2],['GH2-BA-001','c',1,5],
 ['GH2-SP-001','a',2,2],['GH2-RJ-001','b',2,3]
].map(([sector_code,store_key,cycle_week,weekday])=>({scenario_code:'C2',sector_code,store_key,cycle_week,weekday,scheduled:true}));
const dashboardData={
 teams,stores,routeDays:days,
 persons:[
  {id:'person-sp',full_name:'Profissional Teste A',status:'ATIVO',whatsapp:'11999999999'},
  {id:'person-rj',full_name:'Profissional Teste B',status:'ATIVO',whatsapp:'21999999999'}
 ],
 occupancies:[
  {scenario_code:'C2',sector_code:'GH2-SP-001',promoter_id:'person-sp',start_date:'2020-01-01',end_date:null},
  {scenario_code:'C2',sector_code:'GH2-RJ-001',promoter_id:'person-rj',start_date:'2099-12-31',end_date:null}
 ],
 sectorStatuses:[],actualVisits:[],actualImports:[]
};
app.hydrate(dashboardData);
await new Promise(r=>setTimeout(r,0));
const params={scenario:'C2',contract:'ALL',teams,stores,saved:{}};
const initial=app.render(params);
assert.ok(initial.includes('Visão geral da operação'));
assert.ok(initial.includes('Fulltime (CLT)'));
assert.ok(initial.includes('Parttime (CLT)'));
assert.ok(initial.includes('Horistas'));
assert.ok(initial.includes('Aguardando dados'),'Realizadas devem ser pendentes sem arquivo');
assert.ok(initial.includes('Situação das vagas'));
assert.ok(initial.includes('Situação das vagas'));
assert.ok(initial.includes('Vaga Open'));
assert.ok(initial.includes('Em admissão'));
assert.ok(initial.includes('Contratado'));
assert.ok(!initial.includes('<strong>0</strong></div><div class="hdNotice"'),'Não tratar status oficial desconhecido como confirmado');
assert.ok(initial.includes('hdBrazilSVG'),'Mapa com GeoJSON deve carregar');
assert.equal((initial.match(/<path class="hdMapUF /g)||[]).length,27,'27 estados devem ter territorios clicaveis');
assert.equal((initial.match(/<g class="hdMapLabel /g)||[]).length,27,'27 estados devem ter etiquetas com quantidade de setores');
assert.ok(initial.includes('SP <tspan class="hdMapLabelNum">1</tspan>'),'Rotulo de SP deve mostrar um setor');
assert.ok(initial.indexOf('hdMapCard')<initial.indexOf('hdTopMetrics'),'O mapa deve aparecer acima dos indicadores');
assert.ok(initial.includes('hdDetailScroll'),'Listas de setores devem possuir area de rolagem separada');
assert.ok(initial.includes('Visitas programadas'));
assert.ok(initial.includes('Média prevista / ativo'));
assert.ok(initial.includes('3,0'),'Média semanal programada é (4+2)/2 = 3');

const region={hasAttribute:(name)=>name==='data-hd-region',dataset:{hdRegion:'Sudeste'}};
assert.equal(app.handleAction(region),true);
const regionHtml=app.render(params);
assert.equal(app.getState().region,'Sudeste');
assert.ok(regionHtml.includes('Estados desta região'));
assert.ok(regionHtml.includes('hdDetailScroll'));
const uf={hasAttribute:(name)=>name==='data-hd-uf',dataset:{hdUf:'SP'}};
assert.equal(app.handleAction(uf),true);
const ufHtml=app.render(params);
assert.equal(app.getState().uf,'SP');
assert.ok(ufHtml.includes('hdDetailTabs'),'Estado deve abrir abas separadas para setores e promotores');
assert.ok(ufHtml.includes('id="hdScopeSearch"'),'Estado deve ter busca local de setores e promotores');
assert.ok(ufHtml.includes('class="hdDetailScroll"'),'Lista grande deve ter container com rolagem independente');
assert.ok(ufHtml.includes('hdDetailFooter'),'Painel de detalhes deve manter orientação fixa');
assert.ok(ufHtml.includes('Setores do estado'));
const tab={hasAttribute:(name)=>name==='data-hd-tab',dataset:{hdTab:'people'}};
assert.equal(app.handleAction(tab),true);
const peopleHtml=app.render(params);
assert.ok(peopleHtml.includes('Profissional Teste A'));
assert.ok(peopleHtml.includes('Promotores vinculados'));
assert.ok(ufHtml.includes('GH2-SP-001'));
assert.ok(refreshCount>=2,'Seleção deve atualizar a interface');

const imported={
 ...dashboardData,
 actualImports:[
  {scenario_code:'C2',cycle_week:1,period_start:'2026-11-01',period_end:'2026-11-30',coverage_status:'complete',uploaded_at:'2026-11-09T10:00:00Z'},
  {scenario_code:'C2',cycle_week:2,period_start:'2026-11-01',period_end:'2026-11-30',coverage_status:'complete',uploaded_at:'2026-11-09T10:00:00Z'}
 ],
 actualVisits:[{scenario_code:'C2',cycle_week:1,sector_code:'GH2-SP-001',store_key:'a',visit_date:'2026-11-09',result:'realized'}, {scenario_code:'C2',cycle_week:1,sector_code:'GH2-RJ-001',store_key:'b',visit_date:'2026-11-09',result:'realized'}]
};
app.hydrate(imported);
const withActuals=app.render(params);
const totalRow=withActuals.match(/<tr class="hdTableTotal">([\s\S]*?)<\/tr>/)?.[1];
assert.ok(totalRow?.endsWith('<td>0,5</td>'),'Média por ativo não pode incluir realização de setor sem promotor ativo');
assert.ok(!withActuals.includes('Aguardando base de execução'),'Carga de execução completa permite computar realizado');
console.log('HARALD dashboard: 27 UFs, cliques, recortes, modelo, falta de dados e cálculo de execução OK');