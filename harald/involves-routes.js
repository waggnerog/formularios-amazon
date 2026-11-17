(() => {
  "use strict";
  const environments = { SAZONAL: "Sazonal", PADRAO: "Padrão" };
  const days = [
    ["Dom","Domingo"],["Seg","Segunda"],["Ter","Terça"],["Qua","Quarta"],
    ["Qui","Quinta"],["Sex","Sexta"],["Sáb","Sábado"],
  ];
  const formatDate = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  }[c]));
  const key = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("pt-BR");
  const activeDay = value => Number.isInteger(value) && value > 0;
  const num = (n,singular,plural) => n + " " + (n === 1 ? singular : plural);

  let data = null;
  let request = null;
  let parserRequest = null;
  let filter = "";
  let environment = "";
  let error = "";
  const expanded = new Set();

  function readRows(bytes, xlsx) {
    const book = xlsx.read(bytes, { sheetRows: 1002 });
    if (book.SheetNames.length !== 1) throw Error("Use um arquivo com apenas a aba do relatório de roteiros.");
    const sheet = book.Sheets[book.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, raw: true });
    const required = { 0:"Nome do Colaborador",6:"Nome do PDV",20:"Período",
      ...Object.fromEntries(days.map(([,name],i) => [21+i,name])) };
    if (!rows.length || !Object.entries(required).every(([i,name]) =>
      key(String(rows[0][i] ?? "").replace(/^[*]\s*/, "")) === key(name))) {
      throw Error("O cabeçalho difere do modelo de relatório do Involves.");
    }
    if (rows.length>1001) throw Error("O arquivo excede 1.000 linhas de roteiro.");
    const parsed = rows.slice(1).flatMap((row,i) => {
      if (!row.some(value => String(value ?? "").trim())) return [];
      const line = i+2;
      const promoter = String(row[0]).trim();
      const pdv = String(row[6]).trim();
      if (!promoter || !pdv || key(row[20]) !== "semanal") {
        throw Error("Linha "+line+" · informe colaborador, PDV e período Semanal.");
      }
      const ranks = days.map((_,j) => {
        const text = String(row[21+j] ?? "").trim();
        if (!text) return null;
        if (!/^[1-9]\d{0,3}[º°]?$/.test(text) || parseInt(text,10)>1000) {
          throw Error("Linha "+line+" · informe a ordem da visita em "+days[j][1]+".");
        }
        return parseInt(text,10);
      });
      if (!ranks.some(activeDay)) throw Error("Linha "+line+" · selecione pelo menos um dia de atendimento.");
      return [{line,promoter,pdv,days:ranks}];
    });
    if (!parsed.length) throw Error("O arquivo está sem linhas de roteiro.");
    return parsed;
  }

  function getParser() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (parserRequest) return parserRequest;
    parserRequest = new Promise((resolve,reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      script.integrity = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";
      script.crossOrigin = "anonymous";
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(Error("Leitor de Excel indisponível."));
      script.onerror = () => { script.remove(); reject(Error("Não foi possível carregar o leitor de Excel. Tente novamente.")); };
      document.head.append(script);
    }).catch(err => { parserRequest=null; throw err; });
    return parserRequest;
  }

  function groups() {
    const byPromoter = new Map();
    for (const batch of data?.batches || []) {
      for (const row of batch.rows) {
        const id = batch.environment+"|"+key(row.promoter);
        if (!byPromoter.has(id)) byPromoter.set(id, { id, name:row.promoter, phone:row.phone, environment:batch.environment, stores:[] });
        const group = byPromoter.get(id);
        group.phone ||= row.phone;
        group.stores.push(row);
      }
    }
    return [...byPromoter.values()].sort((a,b) => a.name.localeCompare(b.name,"pt-BR"));
  }

  function dayBadges(slots) {
    return "<div class=\"hrDays\" aria-label=\"Dias de atendimento\">"+[1,2,3,4,5,6,0].map(i => {
      const [short,name]=days[i];
      const visited = activeDay(slots[i]);
      const label = name+(visited ? " · atendimento, "+slots[i]+"ª visita" : " · sem atendimento");
      return `<span class="hrDay${visited ? " hrOn" : ""}" title="${label}" aria-label="${label}">${short}</span>`;
    }).join("")+"</div>";
  }

  function card(group) {
    const sectors = [...new Set(group.stores.map(x => x.sector))].join(" · ");
    const phone = String(group.phone ?? "");
    const phoneDigits = phone.replace(/\D/g,"");
    const wa = phoneDigits.length===10 || phoneDigits.length===11 ? "55"+phoneDigits : /^55\d{10,11}$/.test(phoneDigits) ? phoneDigits : "";
    const stores = group.stores.map(row => `<li class="hrStore"><div><strong>${escape(row.store)}</strong>
      <small>${escape(row.sector)} · ${escape(row.city)}/${escape(row.uf)}</small></div>
      ${dayBadges(row.days)}</li>`).join("");
    return `<details class="hrPromoter" data-hr-id="${escape(group.id)}" ${expanded.has(group.id)?"open":""}>
      <summary><div class="hrPerson"><strong>${escape(group.name)}</strong><small>${escape(sectors)}</small></div>
      <span class="hrPhone">${escape(phone || "Telefone pendente")}</span>
      <span class="hrCount">${environments[group.environment]} · ${num(group.stores.length,"loja","lojas")}</span>
      <span class="hrChevron" aria-hidden="true">⌄</span></summary>
      ${wa ? `<div class="hrContact"><a href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">WhatsApp · ${escape(phone)}</a></div>` : ""}
      <ul class="hrStores">${stores}</ul></details>`;
  }

  function renderContent() {
    const root = document.getElementById("hr-routes");
    if (!root) return;
    const people = groups();
    const visible = people.filter(p => (!environment || p.environment===environment) &&
      (!filter || key([p.name,p.phone,...p.stores.flatMap(s => [s.store,s.pdv,s.sector,s.city])].join(" ")).includes(filter)));
    const unlinked = (data?.batches || []).reduce((sum,b) => sum+b.unlinked,0);
    const sources = (data?.batches || []).map(batch => `<li><b>${environments[batch.environment]}</b>
      <span>${escape(batch.file_name)}</span><small>${formatDate.format(new Date(batch.published_at))}</small></li>`).join("");
    const covered = new Set(people.map(p=>key(p.name))).size;
    const canUpload = window.haraldCloud?.role() === "admin";
    root.innerHTML = `<div class="hrHeading"><div><h1>Roteiro Involves</h1>
      <p>Dias por loja conforme os arquivos publicados no Console.</p></div>
      <div class="hrActions"><button type="button" class="btn" id="hr-refresh">Atualizar tela</button>
      ${canUpload ? '<button type="button" class="btn primary" id="hr-upload">Publicar arquivo</button>' : ""}</div></div>
      ${sources ? `<ul class="hrSources" aria-label="Arquivos publicados">${sources}</ul>` : ""}
      ${error ? `<p class="hrStatus" role="alert">${escape(error)}</p>` : ""}
      ${data ? `<div class="hrFilters">
        <label>Ambiente <select id="hr-environment" class="select"><option value="">Todos</option>
        ${Object.entries(environments).map(([val,label]) => `<option value="${val}" ${environment===val?"selected":""}>${label}</option>`).join("")}</select></label>
        <span><b>${covered} de ${data.active_people}</b> promotores com roteiro publicado</span>
        <span class="hrLegend"><i></i> Atendimento <i></i> Sem atendimento</span>
      </div>
      ${unlinked ? `<p class="hrStatus">${num(unlinked,"loja pendente de revisão","lojas pendentes de revisão")} por mudança de vínculo. Publique o arquivo atualizado.</p>` : ""}
      <div class="hrList">${visible.length ? visible.map(card).join("") : '<p class="hrStatus">Nenhum roteiro publicado nesta seleção.</p>'}</div>`
      : (!error ? '<p class="hrStatus" role="status">Carregando os roteiros publicados…</p>' : "")}`;
    document.getElementById("hr-refresh").onclick = () => reload();
    document.getElementById("hr-upload")?.addEventListener("click", openUpload);
    document.getElementById("hr-environment")?.addEventListener("change", event => {
      environment=event.target.value;
      renderContent();
      document.getElementById("hr-environment")?.focus();
    });
    root.querySelectorAll("[data-hr-id]").forEach(el => el.addEventListener("toggle", () => {
      if (el.open) expanded.add(el.dataset.hrId);
      else expanded.delete(el.dataset.hrId);
    }));
  }

  function reload() {
    if (!request) {
      error="";
      request=window.haraldCloud.getInvolvesRoutes().then(next => {data=next;})
        .catch(err => {error=err.message || "Falha ao carregar os roteiros.";})
        .finally(() => {request=null;renderContent();});
    }
    return request;
  }

  function openUpload() {
    const dialog = document.createElement("dialog");
    dialog.className="hrUpload";
    dialog.setAttribute("aria-labelledby","hr-upload-title");
    dialog.innerHTML=`<form class="hrUploadFields">
      <h2 id="hr-upload-title">Publicar arquivo de roteiro</h2>
      <p>Escolha o ambiente. O arquivo substitui a exibição desse ambiente no Console.</p>
      <label>Ambiente<select name="environment" class="input" required>
        <option value="">Selecione</option><option value="SAZONAL">Sazonal</option><option value="PADRAO">Padrão</option>
      </select></label>
      <label>Arquivo de relatório<input type="file" name="file" class="input" accept=".xls,.xlsx" required></label>
      <p class="hrError" role="alert"></p><div class="hrActions"><button class="btn" type="button" id="hr-cancel">Cancelar</button>
      <button class="btn primary" type="submit">Publicar no Console</button></div>
    </form>`;
    document.body.append(dialog);
    const form=dialog.querySelector("form");
    const submit=form.querySelector("[type=submit]");
    dialog.querySelector("#hr-cancel").onclick=()=>dialog.close();
    dialog.addEventListener("cancel",event=>{if(submit.disabled)event.preventDefault();});
    dialog.addEventListener("close",()=>{dialog.remove();document.getElementById("hr-upload")?.focus();});
    form.onsubmit=async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const destination=form.elements.environment.value;
      const file=form.elements.file.files[0];
      const issue=form.querySelector(".hrError");
      issue.textContent="";
      submit.disabled=true;
      dialog.querySelector("#hr-cancel").disabled=true;
      try {
        if (!file || !/\.xlsx?$/i.test(file.name) || file.size>5*1024*1024) throw Error("Selecione um .xls ou .xlsx de até 5 MB.");
        if(request) await request;
        if (!data) throw Error("Atualize a tela e aguarde a leitura da versão atual.");
        const revision=(data.batches.find(b=>b.environment===destination)?.revision)||0;
        const workbook=await getParser();
        const rows=readRows(await file.arrayBuffer(),workbook);
        data=await window.haraldCloud.replaceInvolvesRoute(destination,file.name,rows,revision);
        error="";
        environment=destination;
        renderContent();
        dialog.close();
      } catch(err) {
        issue.textContent=err.message;
      } finally {
        submit.disabled=false;
        dialog.querySelector("#hr-cancel").disabled=false;
      }
    };
    dialog.showModal();
  }

  window.haraldInvolvesRoutes = {
    render: () => '<section id="hr-routes" class="hrPage"></section>',
    afterRender: (search,refresh) => {
      filter=key(search);
      renderContent();
      if(refresh || (!data&&!error)) reload();
    },
    readRows,
  };
})();
