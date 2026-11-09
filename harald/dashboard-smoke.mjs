import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src=readFileSync('harald/dashboard.js','utf8');
const states=JSON.parse(readFileSync('harald/brazil-states.geojson','utf8'));
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
assert.ok(initial.includes('Status dos setores'));
assert.ok(initial.includes('Não informado'));
assert.ok(!initial.includes('<strong>0</strong></div><div class="hdNotice"'),'Não tratar status oficial desconhecido como confirmado');
assert.ok(initial.includes('hdBrazilSVG'),'Mapa com GeoJSON deve carregar');
assert.equal((initial.match(/data-hd-map-uf="/g)||[]).length,27,'Todos os estados devem ser clicáveis');
assert.ok(initial.includes('Visitas programadas'));
assert.ok(initial.includes('Média prevista / ativo'));
assert.ok(initial.includes('3,0'),'Média semanal programada é (4+2)/2 = 3');

const region={hasAttribute:(name)=>name==='data-hd-region',dataset:{hdRegion:'Sudeste'}};
assert.equal(app.handleAction(region),true);
const regionHtml=app.render(params);
assert.equal(app.getState().region,'Sudeste');
assert.ok(regionHtml.includes('Estados da região'));
const uf={hasAttribute:(name)=>name==='data-hd-uf',dataset:{hdUf:'SP'}};
assert.equal(app.handleAction(uf),true);
const ufHtml=app.render(params);
assert.equal(app.getState().uf,'SP');
assert.ok(ufHtml.includes('Profissionais vinculados'));
assert.ok(ufHtml.includes('Profissional Teste A'));
assert.ok(ufHtml.includes('GH2-SP-001'));
assert.ok(refreshCount>=2,'Seleção deve atualizar a interface');

const imported={
 ...dashboardData,
 actualImports:[
  {scenario_code:'C2',cycle_week:1,period_start:'2026-11-01',period_end:'2026-11-30',coverage_status:'complete',uploaded_at:'2026-11-09T10:00:00Z'},
  {scenario_code:'C2',cycle_week:2,period_start:'2026-11-01',period_end:'2026-11-30',coverage_status:'complete',uploaded_at:'2026-11-09T10:00:00Z'}
 ],
 actualVisits:[{scenario_code:'C2',cycle_week:1,sector_code:'GH2-SP-001',store_key:'a',visit_date:'2026-11-09',result:'realized'}]
};
app.hydrate(imported);
const withActuals=app.render(params);
assert.ok(withActuals.includes('0,5'),'Com dois períodos completos, uma visita realizada corresponde a média 0,5');
assert.ok(!withActuals.includes('Aguardando base de execução'),'Carga de execução completa permite computar realizado');
console.log('HARALD dashboard: 27 UFs, cliques, recortes, modelo, falta de dados e cálculo de execução OK');
