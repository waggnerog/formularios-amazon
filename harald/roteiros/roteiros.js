"use strict";

const $ = (selector) => document.querySelector(selector);
const view = $("#view");
const drawer = $("#drawer");
const modeAdmin = new URLSearchParams(location.search).get("modo") === "coordenacao";
const endpoint = "https://mcditxbuemxlaewyuwlw.supabase.co/rest/v1/rpc/harald_route_suggestions";
const publicKey = "sb_publishable_6JplhqTzxWN9hTcIhQkcQw_glWN8TyJ";
const fieldSession = "harald.routes.session";
const consoleSession = "harald.auth.session.v1";
const days = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const own = (record, key) => Object.hasOwn(record, key);
const labels = (numbers) => numbers.length ? numbers.map((n) => days[n - 1]).join(", ") : "Sem disponibilidade";
const date = (value) => dateFormat.format(new Date(value));

let state;
let submissions = [];
let roster = [];
let adminTab = "submissions";
let filter = "";
let hasNext = false;
const selectedForInvolves = new Set();
const isTestSuggestion = (item) => item.stores.some((store) => store.sector === "TESTE");
const hasSuggestedDays = (item) => item.stores.some((store) => store.days.length);

function notice(message = "", error = false) {
  const element = $("#notice");
  element.textContent = message;
  element.hidden = !message;
  element.toggleAttribute("data-error", error);
}

async function request(action, data = {}) {
  const body = modeAdmin ? data : { ...data, token: sessionStorage.getItem(fieldSession) };
  let headers = { apikey: publicKey, "Content-Type": "application/json" };
  if (modeAdmin) {
    let session;
    try { session = JSON.parse(sessionStorage.getItem(consoleSession)); } catch { session = null; }
    if (!session?.access_token) throw Error("Entre no Console Harald para abrir esta área.");
    if (Date.now() > session.expires_at) {
      const res = await fetch(endpoint.split("/rest/")[0] + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers, body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) throw Error("Sua sessão expirou. Entre no Console novamente.");
      const renewed = await res.json();
      session = { ...renewed, expires_at: Date.now() + (Number(renewed.expires_in || 3600) - 30) * 1000 };
      sessionStorage.setItem(consoleSession, JSON.stringify(session));
    }
    headers.Authorization = "Bearer " + session.access_token;
  } else if (publicKey.startsWith("eyJ")) {
    headers.Authorization = "Bearer " + publicKey;
  }
  let res;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ action, data: body }) });
  } catch {
    throw Error("Falha de conexão. Tente novamente.");
  }
  if (!res.ok) throw Error(res.status === 429 ? "Muitas tentativas. Aguarde e tente novamente." : "Não foi possível concluir. Tente novamente.");
  const result = await res.json();
  if (result.expired && !modeAdmin) {
    sessionStorage.removeItem(fieldSession);
    if (drawer.open) drawer.close();
    renderLogin();
  }
  if (result.error) throw Error(result.error);
  return result;
}

async function run(button, operation, errorTarget) {
  button.disabled = true;
  notice();
  if (errorTarget) errorTarget.textContent = "";
  try { await operation(); } catch (error) {
    if (errorTarget && drawer.open) errorTarget.textContent = error.message;
    else notice(error.message, true);
  } finally { button.disabled = false; }
}

function renderLogin() {
  $("#header-action").innerHTML = "";
  view.innerHTML = `<section class="panel narrow flow">
    <div class="heading"><h1>Minhas lojas</h1>
    <p class="muted">Entre para informar os dias em que você pode atender suas lojas.</p></div>
    <form class="flow" id="login">
      <label class="field">CPF (somente números)<input name="cpf" inputmode="numeric" pattern="[0-9]{11}" maxlength="14" autocomplete="username" required></label>
      <label class="field">Senha<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="primary">Entrar</button>
    </form>
  </section>`;
  $("#login [name=cpf]").oninput = (event) => {
    event.target.value = event.target.value.replace(/[^0-9]/g, "").slice(0, 11);
  };
  $("#login").onsubmit = (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    run(event.submitter, async () => {
      const result = await request("login", data);
      sessionStorage.setItem(fieldSession, result.token);
      await refreshField();
    });
  };
}

async function refreshField() {
  state = await request("state");
  renderField();
}

function renderField() {
  $("#header-action").innerHTML = '<button type="button" id="logout" class="quiet">Sair</button>';
  $("#logout").onclick = (event) => run(event.currentTarget, async () => {
    await request("logout");
    sessionStorage.removeItem(fieldSession);
    state = null;
    renderLogin();
  });

  if (state.submitted) {
    view.innerHTML = `<section class="panel narrow flow"><span class="tag good">Enviado</span>
      <h1>Sugestão enviada</h1><p>A coordenação recebeu sua disponibilidade em ${date(state.submitted.at)}.</p>
      <button id="revise" type="button">Enviar uma nova sugestão</button></section>`;
    $("#revise").onclick = (event) => run(event.currentTarget, async () => {
      state = await request("revise", { submission: state.submitted.id });
      renderField();
    });
    return;
  }

  if (!state.name) {
    view.innerHTML = `<section class="panel narrow flow"><h1>Qual é o seu nome?</h1>
      <form id="name-form" class="flow"><label class="field">Nome completo<input name="name" autocomplete="name" minlength="2" maxlength="150" required></label>
      <button type="submit" class="primary">Ver minhas lojas</button></form></section>`;
    $("#name-form").onsubmit = (event) => {
      event.preventDefault();
      run(event.submitter, async () => {
        state = await request("name", { name: new FormData(event.target).get("name") });
        renderField();
      });
    };
    return;
  }

  const done = state.stores.filter((store) => own(state.draft, store.id)).length;
  view.innerHTML = `<section class="flow">
    <div class="heading"><h1>Minhas lojas</h1><p class="muted">${esc(state.name)}, marque todos os dias em que você consegue atender cada loja.</p></div>
    <div class="panel flow"><div class="row"><strong>${done} de ${state.stores.length} lojas preenchidas</strong>
      <button type="button" id="reload-stores" class="quiet">Atualizar lojas</button></div>
      <progress class="progress" aria-label="Lojas preenchidas" value="${done}" max="${state.stores.length}"></progress></div>
    <div class="stores">${state.stores.map((store, index) => `<article class="store">
      <div><h2>${esc(store.name)}</h2><p class="muted">${esc(store.city)}/${esc(store.uf)} · ${esc(store.sector)}${store.visits ? " · " + esc(store.visits) + " visita(s) por semana" : ""}</p>
      ${own(state.draft, store.id) ? `<span class="tag good">${esc(labels(state.draft[store.id]))}</span>` : '<span class="tag pending">Pendente</span>'}</div>
      <button type="button" data-store="${index}" aria-label="Editar disponibilidade de ${esc(store.name)}">${own(state.draft, store.id) ? "Editar dias" : "Escolher dias"}</button></article>`).join("")}</div>
    <div class="row"><span class="muted">O rascunho fica salvo a cada loja.</span><button type="button" class="primary" id="review" ${done !== state.stores.length ? "disabled" : ""}>Revisar e enviar</button></div>
  </section>`;
  view.querySelectorAll("[data-store]").forEach((button) => { button.onclick = () => openStore(Number(button.dataset.store)); });
  $("#reload-stores").onclick = (event) => run(event.currentTarget, refreshField);
  $("#review").onclick = openReview;
}

function showDrawer(title, content) {
  drawer.innerHTML = `<div class="flow"><div class="row"><h2 id="drawer-title">${esc(title)}</h2><button type="button" id="close-drawer" class="quiet" aria-label="Fechar painel">Fechar</button></div>
    ${content}<p class="drawer-error" id="drawer-error" role="alert"></p></div>`;
  $("#close-drawer").onclick = () => drawer.close();
  if (!drawer.open) drawer.showModal();
  else $("#close-drawer").focus();
}

function openStore(index) {
  const store = state.stores[index];
  const saved = state.draft[store.id];
  showDrawer(store.name, `
    <p class="muted">${esc(store.address || (store.city + "/" + store.uf))} · ${esc(store.sector)}</p>
    ${store.week1 || store.week2 ? `<p>Roteiro atual<br><span class="muted">Semana 1 · ${esc(store.week1 || "—")}<br>Semana 2 · ${esc(store.week2 || "—")}</span></p>` : ""}
    <form id="store-form" class="flow"><fieldset><legend>Quais dias você pode atender?</legend><div class="choices">
      ${days.map((day, i) => `<label class="choice"><input type="checkbox" name="day" value="${i + 1}" ${saved?.includes(i + 1) ? "checked" : ""}> ${day}</label>`).join("")}
      <label class="choice"><input type="checkbox" name="none" ${saved?.length === 0 ? "checked" : ""}> Nenhum dia disponível</label>
    </div></fieldset><div class="actions"><button type="submit" class="primary" value="next">Salvar e avançar</button><button type="submit" value="close">Salvar e fechar</button></div></form>`);
  const form = $("#store-form");
  form.onchange = (event) => {
    if (!event.target.checked) return;
    if (event.target.name === "none") form.querySelectorAll('[name="day"]').forEach((input) => { input.checked = false; });
    else form.elements.none.checked = false;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      const formData = new FormData(form);
      const chosen = formData.getAll("day").map(Number);
      if (!chosen.length && !formData.has("none")) throw Error("Escolha os dias ou marque Nenhum dia disponível.");
      state = await request("save", { store: store.id, days: chosen, signature: state.signature });
      renderField();
      const next = state.stores.findIndex((item) => !own(state.draft, item.id));
      if (event.submitter.value === "next" && next >= 0) openStore(next);
      else if (event.submitter.value === "next") openReview();
      else {
        drawer.close();
        view.querySelector(`[data-store="${index}"]`)?.focus();
        notice("Disponibilidade salva.");
      }
    }, $("#drawer-error"));
  };
}

function storeSummary(stores) {
  return `<ul class="listing">${stores.map((store) => `<li><strong>${esc(store.name)}</strong> · ${esc(store.sector)}
    <br><span class="muted">${esc(store.city)}/${esc(store.uf)} · ${esc(labels(store.days))}</span></li>`).join("")}</ul>`;
}

function openReview() {
  showDrawer("Confirme sua sugestão", `${storeSummary(state.stores.map((store) => ({ ...store, days: state.draft[store.id] })))}
    <button class="primary" type="button" id="confirm">Confirmar e enviar</button>`);
  $("#confirm").onclick = (event) => run(event.currentTarget, async () => {
    state = await request("submit", { signature: state.signature });
    drawer.close();
    renderField();
  }, $("#drawer-error"));
}

function renderAdmin() {
  const visible = submissions.filter((item) => {
    const q = filter.toLocaleLowerCase("pt-BR").trim();
    return !q || [item.promoter, ...item.stores.flatMap((s) => [s.sector, s.uf, s.city, s.name])].some((x) => String(x ?? "").toLocaleLowerCase("pt-BR").includes(q));
  });
  const people = roster.filter((person) => [person.name,person.sectors].some((x) => x.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR").trim())));
  const items = adminTab === "submissions" ? visible.map((item) => `<article class="store">
    <div><h2>${esc(item.promoter)}</h2><p class="muted">${date(item.submitted_at)} · ${item.stores.length} loja(s) · ${esc([...new Set(item.stores.map((s) => s.sector))].join(", "))}</p>
    ${item.read_at ? "" : '<span class="tag pending">Nova sugestão</span>'}</div>
    <div class="actions"><button type="button" data-detail="${item.id}">Ver sugestão</button>
    ${hasSuggestedDays(item) && isTestSuggestion(item) ? `<button type="button" data-involves-test="${item.id}">Testar exportação XLSX</button>` : ""}
    ${hasSuggestedDays(item) && !isTestSuggestion(item) ? `<label class="choice"><input type="checkbox" data-involves-id="${item.id}" ${selectedForInvolves.has(String(item.id)) ? "checked" : ""}> Selecionar para o Involves</label>` : ""}</div></article>`) : people.map((person) => `<article class="store">
    <div><h2>${esc(person.name)}</h2><p class="muted">${esc(person.sectors)} · ${person.stores} loja(s)</p><span class="tag">${esc(person.access)}</span></div>
    </article>`);
  $("#header-action").innerHTML = '<a class="button quiet" href="../">Voltar ao Console</a>';
  view.innerHTML = `<section class="flow">
    <div class="heading"><h1>Sugestões de roteiro</h1><p class="muted">Disponibilidade de atendimento dos promotores horistas.</p></div>
    <div class="actions"><button type="button" id="submissions" aria-pressed="${adminTab === "submissions"}" class="${adminTab === "submissions" ? "primary" : ""}">Recebidas</button>
    <button type="button" id="people" aria-pressed="${adminTab === "people"}" class="${adminTab === "people" ? "primary" : ""}">Acesso dos promotores</button>
    <button type="button" id="reload-admin">Atualizar</button>
    ${adminTab === "submissions" ? '<button type="button" id="export-involves" class="primary">Exportar para o Involves (XLSX)</button><button type="button" id="export" class="quiet">Relatório de disponibilidade (CSV)</button>' : ""}</div>
    <label class="field">Buscar <input id="filter" type="search" value="${esc(filter)}" placeholder="${adminTab === "submissions" ? "Promotor, posição, cidade, UF ou loja" : "Promotor ou posição"}"></label>
    <div id="admin-list" class="stores">${items.join("") || `<p class="panel muted">${filter ? "Nenhum resultado." : adminTab === "submissions" ? "Nenhuma sugestão recebida." : "Nenhum cadastro vinculado."}</p>`}</div>
    ${adminTab === "submissions" && hasNext ? '<button id="more" type="button">Carregar mais</button>' : ""}
  </section>`;
  for (const tab of ["submissions","people"]) {
    $("#" + tab).onclick = (event) => run(event.currentTarget, async () => {
      adminTab = tab;
      filter = "";
      await refreshAdmin();
    });
  }
  $("#reload-admin").onclick = (event) => run(event.currentTarget, refreshAdmin);
  $("#filter").oninput = (event) => {
    const input = event.currentTarget;
    filter = input.value;
    renderAdmin();
    $("#filter").focus();

  };
  view.querySelectorAll("[data-detail]").forEach((button) => { button.onclick = () => openDetail(button.dataset.detail, button); });
  if ($("#more")) $("#more").onclick = (event) => run(event.currentTarget, () => loadSubmissions(submissions.at(-1).id));
  if ($("#export")) $("#export").onclick = (event) => run(event.currentTarget, exportCsv);
  view.querySelectorAll("[data-involves-test]").forEach((button) => {
    button.onclick = () => run(button, () => prepareInvolves(
      submissions.filter((item) => String(item.id) === button.dataset.involvesTest && isTestSuggestion(item))
    ));
  });
  const involvesButton = $("#export-involves");
  if (involvesButton) {
    const updateLabel = () => {
      involvesButton.textContent = selectedForInvolves.size
        ? "Exportar para o Involves (XLSX) · " + selectedForInvolves.size
        : "Exportar para o Involves (XLSX)";
    };
    updateLabel();
    view.querySelectorAll("[data-involves-id]").forEach((input) => {
      input.onchange = () => {
        const id = input.dataset.involvesId;
        if (input.checked) selectedForInvolves.add(id);
        else selectedForInvolves.delete(id);
        updateLabel();
      };
    });
    involvesButton.onclick = (event) => run(event.currentTarget, () => {
      const selected = submissions.filter((item) => selectedForInvolves.has(String(item.id)) && !isTestSuggestion(item));
      if (selected.length) return prepareInvolves(selected);
      const available = visible.filter(hasSuggestedDays);
      if (available.length === 1) return prepareInvolves(available);
      if (!available.length) throw Error("Nenhuma sugestão com dias disponíveis nesta lista.");
      throw Error("Marque as sugestões na lista. Para um envio fictício, use Testar exportação XLSX.");
    });
  }
}

async function loadSubmissions(before) {
  const page = (await request("admin_list", before ? { before } : {})).submissions;
  submissions = before ? submissions.concat(page) : page;
  if (!before) selectedForInvolves.clear();
  hasNext = page.length === 50;
  renderAdmin();
}

async function refreshAdmin() {
  if (adminTab === "submissions") await loadSubmissions();
  else {
    roster = (await request("admin_people")).people;
    renderAdmin();
  }
}

function openDetail(id, button) {
  const item = submissions.find((s) => String(s.id) === id);
  showDrawer(item.promoter, `<p class="muted">Enviado em ${date(item.submitted_at)}${item.entered_name !== item.promoter ? " · Nome informado: " + esc(item.entered_name) : ""}</p>
    ${storeSummary(item.stores)}`);
  if (!item.read_at) run(button, async () => {
    await request("admin_read", { id });
    item.read_at = new Date().toISOString();
    button.closest("article").querySelector(".tag")?.remove();
  }, $("#drawer-error"));
}

async function loadInvolves() {
  const files = [
    ["fflate", "vendor/fflate-0.8.2.js"],
    ["haraldInvolvesTemplate", "involves-template.js"],
    ["haraldInvolves", "involves.js?v=4"],
  ];
  await Promise.all(files.filter(([global]) => !window[global]).map(([, src]) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(Error("Falha ao carregar a exportação. Tente novamente."));
    };
    document.head.append(script);
  })));
  return window.haraldInvolves;
}

async function prepareInvolves(items) {
  if (!items.length) throw Error("Selecione as sugestões que deseja exportar.");
  const test = items.every(isTestSuggestion);
  if (!test && items.some(isTestSuggestion)) throw Error("Baixe os envios de teste em um arquivo separado.");
  const exporter = await loadInvolves();
  const weekFields = (store, suffix, weekIndex) => exporter.dayNumbers.map((day, index) => {
    if (!store.days.includes(day)) return "";
    return `<label class="field">${exporter.weekdays[index]}
      <input name="visit-${suffix}-${weekIndex}-${day}" placeholder="1º ou 09:00 até 10:00" maxlength="25">
    </label>`;
  }).join("");
  const suggested = (item, index) => `<fieldset class="panel flow" data-involves-promoter>
    <legend>${esc(item.promoter)}</legend>
    <label class="field">Nome cadastrado no Involves<input name="name-${index}" required value="${esc(item.promoter)}"></label>
    <label class="field">Período<select name="period-${index}" required data-involves-period>
      <option value="">Selecione</option><option>Semanal</option><option>Quinzenal</option>
    </select></label>
    ${item.stores.map((store, i) => {
      const suffix = `${index}-${i}`;
      if (!store.days.length) return `<p class="muted"><strong>${esc(store.name)}</strong> · Sem disponibilidade</p>`;
      return `<details class="panel flow">
        <summary><strong>${esc(store.name)}</strong> · ${esc(labels(store.days))}</summary>
        <p class="muted">${esc(store.sector)}${store.visits ? " · Visitas previstas por semana: " + esc(store.visits) : ""}</p>
        <label class="choice"><input type="checkbox" name="skip-${suffix}" data-involves-skip> Excluir da exportação</label>
        <fieldset class="flow" data-involves-store>
          <label class="field">Nome do PDV cadastrado no Involves<input name="pdv-${suffix}" value="${esc(store.name)}"></label>
          <label class="field">Código do PDV (opcional)<input name="code-${suffix}"></label>
          <fieldset class="flow" data-week-first><legend>Dias do roteiro</legend>${weekFields(store, suffix, 0)}</fieldset>
          <fieldset class="flow" data-week-second hidden><legend>Semana próxima</legend>${weekFields(store, suffix, 1)}</fieldset>
        </fieldset>
      </details>`;
    }).join("")}
  </fieldset>`;
  showDrawer(test ? "Testar exportação Involves" : "Preparar exportação Involves", `
    ${test ? '<p class="tag pending">Dados fictícios. Use este arquivo para conferir o modelo.</p>' : ""}
    <p>Confira os nomes no Involves, selecione o período e preencha a ordem ou o horário das visitas nos dias que você aprovar. Deixe em branco os demais dias.</p>
    <form id="involves-form" class="flow">
      ${items.map(suggested).join("")}
      <label class="choice"><input type="checkbox" required> Conferi os nomes, a frequência e os dias das visitas</label>
      <button class="primary" type="submit">Baixar XLSX do Involves</button>
    </form>`);
  const form = $("#involves-form");
  form.querySelectorAll("[data-involves-period]").forEach((select) => {
    select.onchange = () => {
      const promoter = select.closest("[data-involves-promoter]");
      const fortnightly = select.value === "Quinzenal";
      promoter.querySelectorAll("[data-week-first] legend").forEach((legend) => {
        legend.textContent = fortnightly ? "Semana atual" : "Dias do roteiro";
      });
      promoter.querySelectorAll("[data-week-second]").forEach((week) => { week.hidden = !fortnightly; });
    };
  });
  form.querySelectorAll("[data-involves-skip]").forEach((input) => {
    input.onchange = () => {
      input.closest("details").querySelector("[data-involves-store]").disabled = input.checked;
    };
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      exporter.download(exporter.buildRows(items, new FormData(form)), test);
      drawer.close();
      notice(test ? "Planilha de teste gerada com as colunas do Involves." : "Planilha gerada. No Involves, importe pela opção Relatórios.");
    }, $("#drawer-error"));
  };
}

async function exportCsv() {
  const all = [];
  let before;
  do {
    const { submissions: page } = await request("admin_list", before ? { before } : {});
    all.push(...page);
    before = page.length === 50 ? page.at(-1).id : null;
  } while (before);
  if (!all.length) { notice("Ainda não há sugestões para exportar."); return; }

  const table = [["Envio","Data do envio (Brasília)","Promotor","Nome informado","Posição","Loja","Cidade","UF","Visitas por semana","Roteiro semana 1","Roteiro semana 2","Dias disponíveis"]];
  all.forEach((item) => item.stores.forEach((store) => {
    table.push([item.id,date(item.submitted_at),item.promoter,item.entered_name,store.sector,store.name,store.city,store.uf,store.visits,store.week1,store.week2,labels(store.days)]);
  }));
  const csvCell = (value) => {
    let cell = String(value ?? "");
    if (/^[\s\u200b-\u200f\ufeff]*[=+@-]|^[\t\r\n]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  };
  const blob = new Blob(["\ufeff",table.map((row) => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: "Sugestoes_de_Roteiro_Harald.csv" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (modeAdmin) {
  renderAdmin();
  refreshAdmin().catch((error) => notice(error.message, true));
} else if (sessionStorage.getItem(fieldSession)) {
  refreshField().catch((error) => { renderLogin(); notice(error.message, true); });
} else {
  renderLogin();
}
