import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src=readFileSync('harald/dashboard.js','utf8');
const states=JSON.parse(readFileSync('harald/brazil-states.geojson','utf8'));
const styles=readFileSync('harald/dashboard.css','utf8');

assert.ok(styles.includes('.hdMapLayout{display:grid;grid-template-columns:'),'Mapa deve ter colunas próprias');
assert.ok(styles.includes('.hdDonut'),'Gráfico circular Horista precisa de estilo');
assert.ok(styles.includes('.hdRegionBars'),'Barras regionais Horistas precisam de estilo');
assert.equal(states.features.length,27,'Mapa precisa conter as 27 UFs brasileiras');
assert.equal(new Set(states.features.map(x=>x.properties.sigla)).size,27,'UFs duplicadas');

new vm.Script(src,{filename:'dashboard.js'});
let refreshCount=0;
const scope={
 window:{haraldApp:{refresh:()=>refreshCount++},haraldPeople:{openSector:()=>{},openPerson:()=>{}}},
 fetch:async()=>({ok:true,json:async()=>states}),
 console,Date,Intl,Set,Map,Number,Math,Object,String,Array,JSON
};
vm.runInNewContext(src,scope);
const app=scope.window.haraldDashboard;
assert.equal(typeof app.render,'function');

const teams=[
 {sc:'C2',sector:'GH2-BA-001',uf:'BA',model:'HORISTA',modal:'VT',hours:6,pdvs:1,cities:'Salvador',visits:3,region:'Nordeste'},
 {sc:'C2',sector:'GH2-SP-001',uf:'SP',model:'HORISTA',modal:'VT',hours:6,pdvs:1,cities:'São Paulo',visits:2,region:'Sudeste'},
 {sc:'C2',sector:'GH2-RS-001',uf:'RS',model:'HORISTA',modal:'VT',hours:6,pdvs:1,cities:'Porto Alegre',visits:2,region:'Sul'}
];
const stores=[
 {sc:'C2',src:'a',id:'a',sector:'GH2-BA-001',uf:'BA',model:'HORISTA',n:'Loja BA'},
 {sc:'C2',src:'b',id:'b',sector:'GH2-SP-001',uf:'SP',model:'HORISTA',n:'Loja SP'},
 {sc:'C2',src:'c',id:'c',sector:'GH2-RS-001',uf:'RS',model:'HORISTA',n:'Loja RS'}
];
const routeDays=[
 ['GH2-BA-001','a',1,1],['GH2-BA-001','a',1,3],['GH2-SP-001','b',1,2],['GH2-RS-001','c',1,5],
 ['GH2-BA-001','a',2,2],['GH2-SP-001','b',2,3]
].map(([sector_code,store_key,cycle_week,weekday])=>({scenario_code:'C2',sector_code,store_key,cycle_week,weekday,scheduled:true}));

const dashboardData={
 teams,stores,routeDays,
 persons:[{id:'person-1',full_name:'Promotor Teste',status:'VINCULADO',whatsapp:'11999999999'}],
 occupancies:[
  {scenario_code:'C2',sector_code:'GH2-BA-001',promoter_id:'person-1',start_date:null,end_date:null},
  {scenario_code:'C2',sector_code:'GH2-RS-001',promoter_id:'person-1',start_date:null,end_date:null}
 ],
 sectorStatuses:[
  {scenario_code:'C2',sector_code:'GH2-BA-001',status:'open',source_status:'VAGA OPEN'},
  {scenario_code:'C2',sector_code:'GH2-RS-001',status:'hired',source_status:'CONTRATADO'}
 ],
 sectorCandidates:[],actualVisits:[],actualImports:[],
 sourceContracts:[{source_key:'horista',display_name:'Controle Operacional Horistas',expected_file_name:'Controle Operacional Horistas.xlsx',notes:{source_of_truth:true}}],
 sourceState:{
  file_name:'Controle Operacional Horistas.xlsx',
  processed_at:'2026-11-11T13:50:00Z',
  quality:{filled_with_open_status_count:1,status_not_informed_sector_count:1}
 }
};

app.hydrate(dashboardData);
await new Promise(r=>setTimeout(r,0));
const params={scenario:'C2',contract:'HORISTA',teams,stores,saved:{}};
const initial=app.render(params);

assert.ok(initial.includes('Controle Operacional Horistas'),'Título do painel deve refletir a fonte única');
assert.ok(initial.includes('Vagas Horistas'),'Painel visual Horista ausente');
assert.ok(initial.includes('hdDonut'),'Gráfico circular de preenchimento ausente');
assert.ok(initial.includes('Distribuição por região'),'Barras regionais ausentes');
assert.ok(initial.includes('Vagas preenchidas'),'KPI de preenchimento ausente');
assert.ok(initial.includes('Promotores únicos'),'KPI de pessoas únicas ausente');
assert.ok(initial.includes('Qualidade da fonte'),'Alerta de inconsistências da fonte ausente');
assert.ok(initial.includes('Vaga Open'),'Status da fonte deve ser exibido separadamente');
assert.ok(initial.includes('Contratado'),'Status Contratado ausente');
assert.ok(initial.includes('Sem status'),'Ausência de status deve ser visível');
assert.ok(!initial.includes('Fulltime (CLT)'),'Console Horista não deve exibir Fulltime');
assert.ok(!initial.includes('Parttime (CLT)'),'Console Horista não deve exibir Parttime');
assert.ok(initial.includes('hdBrazilSVG'),'Mapa com GeoJSON deve carregar');
assert.equal((initial.match(/<path class="hdMapUF /g)||[]).length,27,'27 estados devem ter territórios clicáveis');
assert.equal((initial.match(/<g class="hdMapLabel /g)||[]).length,27,'27 estados devem ter etiquetas');
assert.ok(initial.includes('SP <tspan class="hdMapLabelNum">1</tspan>'),'SP deve mostrar um setor');
assert.ok(initial.indexOf('hdMapCard')<initial.indexOf('hdTopMetrics'),'Mapa deve aparecer acima dos KPIs');
assert.ok(initial.includes('Visitas programadas'),'Programação semanal deve permanecer visível');

const region={hasAttribute:name=>name==='data-hd-region',dataset:{hdRegion:'Sudeste'}};
assert.equal(app.handleAction(region),true);
const regionHtml=app.render(params);
assert.equal(app.getState().region,'Sudeste');
assert.ok(regionHtml.includes('Estados desta região'));

const uf={hasAttribute:name=>name==='data-hd-uf',dataset:{hdUf:'SP'}};
assert.equal(app.handleAction(uf),true);
const ufHtml=app.render(params);
assert.equal(app.getState().uf,'SP');
assert.ok(ufHtml.includes('Setores do estado'));
assert.ok(ufHtml.includes('GH2-SP-001'));
assert.ok(refreshCount>=2,'Seleção geográfica deve atualizar a interface');

console.log('HARALD dashboard: fonte única Horista, preenchimento por promotor, qualidade e mapa OK');
