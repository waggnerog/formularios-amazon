import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Um setor pode ter duas pessoas e uma loja sem atendimento.
const sector='GH2-RS-001';
const base={sector_code:sector,state_code:'RS',city:'Porto Alegre',weekly_visits:1,service_time:1,store_weekly_hours:1,days_week1:'SEG',days_week2:'SEG'};
const rows=[
 {...base,source_row:2,store_name:'Loja A',cnpj:'00000000000001',promoter_name:'Pessoa A',phone:'11999990001'},
 {...base,source_row:3,store_name:'Loja B',cnpj:'00000000000002',promoter_name:'Pessoa B',phone:'11999990002'},
 {...base,source_row:4,store_name:'Loja C',cnpj:'00000000000003',promoter_name:null,phone:null},
];
const cloud=readFileSync('harald/cloud.js','utf8');
const load=cloud.slice(cloud.indexOf('async function loadData()'),cloud.indexOf('async function savePerson()'));
let mounted,dashboard;
const scope={role:'viewer',promoterIds:{},promoterNames:{},personKeyToId:{},notes:[],baseline:null,isReady:false,legacySnapshot:null,
 getAll:async table=>table==='harald_horista_console_rows'?rows:[],clone:v=>JSON.parse(JSON.stringify(v)),api(){},setStatus(){},$:()=>null,
 document:{body:{classList:{remove(){},add(){}}}},
 window:{haraldApp:{getSnapshot:()=>mounted?.saved||{},mount:p=>{mounted=p;},refresh(){}},haraldPeople:{hydrate(){}},haraldDashboard:{hydrate:p=>{dashboard=p;}}},
};
vm.createContext(scope);await vm.runInContext(load+'\nloadData()',scope);
assert.equal(dashboard.persons.length,2,'Todos os promotores do setor compartilhado devem existir');
assert.equal(dashboard.occupancies.length,2,'Cada pessoa precisa de seu vínculo com o setor');
assert.equal(new Set(dashboard.occupancies.map(o=>o.id)).size,2,'Vínculos devem ter identidades distintas');
assert.equal(mounted.stores[2].promoterName,'','A loja sem pessoa não pode herdar a do setor');
assert.equal(mounted.stores[2].sourceStatus,'VAGA OPEN');
assert.equal(mounted.stores[1].promoterId,dashboard.persons.find(p=>p.full_name==='Pessoa B').id);

const html=readFileSync('harald/index.html','utf8');
const helpers=html.slice(html.indexOf('const storePromoter='),html.indexOf('const initial='));
const ui={window:{},saved:mounted.saved,state:{uf:'',drawer:null},scopedStores:()=>mounted.stores,getStore:id=>mounted.stores.find(s=>s.id===id),norm:x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()};
vm.runInNewContext(helpers+'\nwindow.test={promoterRoster,storePromoter,promoter,drawerPromoter};',ui);
const roster=ui.window.test.promoterRoster();
assert.equal(roster.length,2);assert.equal(roster[0].stores.length,1);assert.equal(roster[1].stores.length,1);
assert.equal(ui.window.test.storePromoter(mounted.stores[2]).name,'');
assert.equal(ui.window.test.promoter(sector).members.length,2);
ui.state.drawer={type:'store',id:mounted.stores[1].id,sector};
assert.equal(ui.window.test.drawerPromoter(sector).name,'Pessoa B','WhatsApp e ficha devem seguir a pessoa da loja');

const dashScope={window:{haraldApp:{refresh(){}}},fetch:async()=>({ok:true,json:async()=>JSON.parse(readFileSync('harald/brazil-states.geojson','utf8'))}),console,Date,Intl,Set,Map,Number,Math,Object,String,Array,JSON};
vm.runInNewContext(readFileSync('harald/dashboard.js','utf8'),dashScope);
dashScope.window.haraldDashboard.hydrate(dashboard);
await new Promise(r=>setTimeout(r,0));
const rendered=dashScope.window.haraldDashboard.render({scenario:'C2',contract:'HORISTA',teams:mounted.teams,stores:mounted.stores,saved:mounted.saved});
assert.match(rendered,/Promotores únicos<\/div><strong>2<\/strong>/,'Painel deve contar as duas pessoas');
assert.match(rendered,/Lojas com promotor<\/div><strong>2<\/strong>/,'Painel deve contar apenas as duas lojas atribuídas');
assert.match(rendered,/Média prevista \/ promotor<\/div><strong>1,0<\/strong>/,'Média deve excluir lojas sem promotor');
console.log('HARALD: setor compartilhado preserva as pessoas, suas lojas e a cobertura real.');
