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
const routeDays = days.slice(0, 5);
const friday = routeDays.length;
const routeException = "Se alguma loja precisar de atendimento no fim de semana, fale com o Luis para combinar.";
const visitLimit = (store) => {
  const limit = Number(store.visits);
  return Number.isInteger(limit) && limit >= 1 && limit <= routeDays.length ? limit : 0;
};
const visitCount = (count) => count === 1 ? "1 visita" : count + " visitas";
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const own = (record, key) => Object.hasOwn(record, key);
const labels = (numbers) => numbers.length ? numbers.map((n) => days[n - 1]).join(", ") : "Sem disponibilidade";
const date = (value) => dateFormat.format(new Date(value));

function planningNotes(selectedDays) {
  const selected = new Set(selectedDays);
  const notes = [];
  if (selected.has(friday)) {
    notes.push("Se puder, troque a sexta por um dia de segunda a quinta e deixe a sexta como margem para imprevistos. Se a loja precisar, pode manter.");
  }
  if (selectedDays.some((day) => selected.has(day + 1))) {
    notes.push("Você escolheu dias seguidos para esta loja. Se puder, deixe pelo menos um dia de intervalo para distribuir melhor as visitas.");
  }
  return notes;
}

let state;
let submissions = [];
let roster = [];
let pendingPeriod = "all";
let pendingReport = null;
const pendingPeriods = [
  ["all", "Desde o início"], ["today", "Hoje"], ["yesterday", "Ontem"],
  ["week", "Esta semana"], ["month", "Este mês"],
];
let adminTab = "submissions";
let filter = "";
let hasNext = false;
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
    <div class="promoter-area-label">ÁREA DO PROMOTOR</div>
    <div class="heading"><h1>Disponibilidade de visitas</h1>
    <p class="muted">Este acesso é somente para promotores vinculados. Entre com CPF e senha para ver suas lojas.</p></div>
    <form class="flow" id="login">
      <label class="field">CPF <small class="muted">Digite os 11 números, sem pontos e traço.</small><input name="cpf" inputmode="numeric" pattern="[0-9]{11}" maxlength="14" autocomplete="username" required></label>
      <label class="field">Senha<input name="password" type="password" inputmode="numeric" autocomplete="current-password" required></label>
      <button type="submit" class="primary">Entrar como promotor</button>
    </form>
    <div class="coord-entry"><div><b>Você é da coordenação?</b><small>Não use CPF nesta tela. O Console administrativo usa e-mail e senha.</small></div><a class="button" href="../">Abrir Console HARALD</a></div>
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
      $("#field-title")?.focus();
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
      <h1 id="field-title" tabindex="-1">Sugestão enviada</h1><p>A coordenação recebeu seus dias disponíveis em ${date(state.submitted.at)}.</p>
      <p class="muted">Se sua disponibilidade mudar, você pode enviar outra sugestão.</p>
      <button id="revise" type="button">Enviar uma nova sugestão</button></section>`;
    $("#revise").onclick = (event) => run(event.currentTarget, async () => {
      state = await request("revise", { submission: state.submitted.id });
      renderField();
    });
    return;
  }

  const done = state.stores.filter((store) => own(state.draft, store.id)).length;
  const firstName = state.name?.trim().split(/\s+/)[0];
  const complete = done === state.stores.length;
  view.innerHTML = `<section class="flow">
    <div class="heading"><h1 id="field-title" tabindex="-1">Minhas lojas</h1>
      <p>${firstName ? "Olá, " + esc(firstName) + "! " : ""}Você pode sugerir visitas de <strong>segunda a sexta</strong>. Sempre que possível, concentre o atendimento de segunda a quinta e deixe a sexta como margem para imprevistos.</p>
      <p class="muted">${routeException}</p></div>
    <div class="panel flow"><div class="row"><strong>${done} de ${state.stores.length} lojas respondidas</strong>
      <button type="button" id="reload-stores" class="quiet">Atualizar lojas</button></div>
      <progress class="progress" aria-label="Lojas respondidas" value="${done}" max="${state.stores.length}"></progress></div>
    <div class="stores">${state.stores.map((store, index) => `<article class="store">
      <div><h2>${esc(store.name)}</h2><p class="muted">${esc(store.city)}/${esc(store.uf)} · ${esc(store.sector)}${store.visits ? " · " + esc(store.visits) + " visita(s) por semana" : ""}</p>
      ${own(state.draft, store.id) ? `<span class="tag ${state.draft[store.id].length < visitLimit(store) ? "pending" : "good"}">${esc(labels(state.draft[store.id]))}</span>` : '<span class="tag pending">Falta responder</span>'}</div>
      <button type="button" data-store="${index}" aria-label="${own(state.draft, store.id) ? "Editar dias de" : "Escolher dias de"} ${esc(store.name)}">${own(state.draft, store.id) ? "Editar dias" : "Escolher dias"}</button></article>`).join("")}</div>
    <div class="row"><p class="muted">${complete ? "Tudo preenchido. Confira os dias antes de enviar." : "Salve cada loja. Quando responder todas, você poderá revisar e enviar."}</p><button type="button" class="primary" id="review" ${complete ? "" : "disabled"}>Revisar e enviar</button></div>
  </section>`;
  view.querySelectorAll("[data-store]").forEach((button) => { button.onclick = () => openStore(Number(button.dataset.store)); });
  $("#reload-stores").onclick = (event) => run(event.currentTarget, refreshField);
  $("#review").onclick = openReview;
}

function showDrawer(title, content, weekly = false) {
  drawer.classList.toggle("weekly-drawer", weekly);
  drawer.innerHTML = `<div class="flow"><div class="row drawer-heading"><div>${weekly ? '<p class="schedule-eyebrow">SUGESTÃO DE ROTEIRO</p>' : ''}<h2 id="drawer-title" tabindex="-1">${esc(title)}</h2></div><button type="button" id="close-drawer" class="quiet" aria-label="Fechar painel">Fechar</button></div>
    ${content}<p class="drawer-error" id="drawer-error" role="alert"></p></div>`;
  $("#close-drawer").onclick = () => drawer.close();
  if (!drawer.open) drawer.showModal();
  $("#drawer-title").focus();
}

function openStore(index) {
  const store = state.stores[index];
  const saved = state.draft[store.id];
  const limit = visitLimit(store);
  if (!limit) {
    showDrawer(store.name, '<p>A frequência semanal desta loja precisa ser conferida. Fale com o Luis para ajustar seu roteiro.</p>');
    return;
  }
  showDrawer(store.name, `
    <p class="muted">${esc(store.address || (store.city + "/" + store.uf))} · ${esc(store.sector)}</p>
    ${store.week1 || store.week2 ? `<details><summary>Ver roteiro atual</summary><p class="muted">Semana 1 · ${esc(store.week1 || "—")}<br>Semana 2 · ${esc(store.week2 || "—")}</p></details>` : ""}
    <form id="store-form" class="flow"><fieldset><legend>Em quais dias você pode atender esta loja?</legend>
      <p class="muted day-hint">Esta loja tem <strong>${visitCount(limit)} por semana</strong>. Escolha até ${limit} ${limit === 1 ? "dia" : "dias"} de segunda a sexta. Para trocar um dia, desmarque a escolha anterior.</p><div class="choices">
      ${routeDays.map((day, i) => `<label class="choice"><input type="checkbox" name="day" value="${i + 1}" ${saved?.includes(i + 1) ? "checked" : ""}> ${day}</label>`).join("")}
      <label class="choice"><input type="checkbox" name="none" ${saved?.length === 0 ? "checked" : ""}> Nenhum dia disponível</label>
    </div><p id="visit-count" class="visit-count" role="status"></p>
      <div id="planning-notes" class="planning-notes" aria-live="polite" aria-atomic="true"></div>
      <p id="availability-note" class="muted">Se sua disponibilidade for menor que a frequência da loja, fale com o Luis para combinar o atendimento.</p>
    </fieldset><div class="actions"><button type="submit" class="primary" value="next">Salvar e avançar</button><button type="submit" value="close">Salvar e fechar</button></div></form>`);
  const form = $("#store-form");
  const dayInputs = [...form.querySelectorAll('[name="day"]')];
  const updateChoices = () => {
    const selectedDays = dayInputs.filter((input) => input.checked).map((input) => Number(input.value));
    const selected = selectedDays.length;
    dayInputs.forEach((input) => { input.disabled = selected >= limit && !input.checked; });
    $("#visit-count").textContent = selected + " de " + limit + (limit === 1 ? " dia selecionado." : " dias selecionados.") +
      (selected === limit ? " Limite atingido." : "");
    $("#availability-note").hidden = selected === limit;
    $("#planning-notes").innerHTML = planningNotes(selectedDays).map((note) => `<p>${esc(note)}</p>`).join("");
  };
  form.onchange = (event) => {
    if (event.target.checked) {
      if (event.target.name === "none") dayInputs.forEach((input) => { input.checked = false; });
      else form.elements.none.checked = false;
    }
    updateChoices();
  };
  updateChoices();
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

function storeSummary(stores, showPlanningNotes = false) {
  return `<ul class="listing">${stores.map((store) => {
    const notes = showPlanningNotes ? planningNotes(store.days) : [];
    return `<li><strong>${esc(store.name)}</strong> · ${esc(store.sector)}
      <br><span class="muted">${esc(store.city)}/${esc(store.uf)} · ${esc(labels(store.days))}</span>
      ${notes.length ? `<div class="planning-notes">${notes.map((note) => `<p>${esc(note)}</p>`).join("")}</div>` : ""}</li>`;
  }).join("")}</ul>`;
}

function openReview() {
  const hasLimitedAvailability = state.stores.some((store) => (state.draft[store.id]?.length ?? 0) < visitLimit(store));
  showDrawer("Revise seus dias", `<p>Confira os dias escolhidos para cada loja. Ao confirmar, sua sugestão será enviada à coordenação.</p>
    ${hasLimitedAvailability ? '<p class="tag pending">Algumas lojas ficaram com menos dias do que o previsto. Fale com o Luis para combinar como completar o atendimento.</p>' : ""}
    ${storeSummary(state.stores.map((store) => ({ ...store, days: state.draft[store.id] })), true)}
    <div class="actions"><button class="primary" type="button" id="confirm">Confirmar e enviar</button>
    <button type="button" id="back-to-stores">Voltar às lojas</button></div>`);
  $("#back-to-stores").onclick = () => {
    drawer.close();
    $("#review").focus();
  };
  $("#confirm").onclick = (event) => run(event.currentTarget, async () => {
    state = await request("submit", { signature: state.signature });
    drawer.close();
    renderField();
    $("#field-title")?.focus();
  }, $("#drawer-error"));
}

function renderAdmin() {
  const visible = submissions.filter((item) => {
    const q = filter.toLocaleLowerCase("pt-BR").trim();
    return !q || [item.promoter, ...item.stores.flatMap((s) => [s.sector, s.uf, s.city, s.name])].some((x) => String(x ?? "").toLocaleLowerCase("pt-BR").includes(q));
  });
  const pending = adminTab === "pending";
  const q = filter.toLocaleLowerCase("pt-BR").trim();
  const people = (pending ? pendingReport?.people ?? [] : roster)
    .filter((person) => [person.name, person.sectors].some((x) => x.toLocaleLowerCase("pt-BR").includes(q)));
  const empty = filter ? "Nenhum resultado." : pending
    ? pendingReport
      ? pendingReport.total ? "Todos os promotores com acesso responderam nesse período." : "Nenhum promotor com acesso ao formulário."
      : "Carregando pendências…"
    : adminTab === "submissions" ? "Nenhuma sugestão recebida." : "Nenhum cadastro vinculado.";
  const items = adminTab === "submissions" ? visible.map((item) => `<article class="store">
    <div><h2>${esc(item.promoter)}</h2><p class="muted">${date(item.submitted_at)} · ${item.stores.length} loja(s) · ${esc([...new Set(item.stores.map((s) => s.sector))].join(", "))}</p>
    ${item.read_at ? "" : '<span class="tag pending">Nova sugestão</span>'}</div>
    <div class="actions"><button type="button" data-detail="${item.id}">Ver sugestão</button>
    ${hasSuggestedDays(item) && isTestSuggestion(item) ? `<button type="button" data-involves-test="${item.id}">Testar exportação XLSX</button>` : ""}
    </div></article>`) : people.map((person) => `<article class="store">
    <div><h2>${esc(person.name)}</h2><p class="muted">${esc(person.sectors)} · ${person.stores} loja(s)</p>${pending ? '<span class="tag pending">Aguardando envio</span>' : `<span class="tag">${esc(person.access)}</span>`}</div>
    </article>`);
  $("#header-action").innerHTML = '<a class="button quiet" href="../">Voltar ao Console</a>';
  view.innerHTML = `<section class="flow">
    <div class="heading"><h1>Sugestões de roteiro</h1><p class="muted">Disponibilidade de atendimento dos promotores horistas.</p></div>
    <div class="actions"><button type="button" id="submissions" aria-pressed="${adminTab === "submissions"}" class="${adminTab === "submissions" ? "primary" : ""}">Recebidas</button>
    <button type="button" id="pending" aria-pressed="${pending}" class="${pending ? "primary" : ""}">Quem ainda não respondeu</button>
    <button type="button" id="people" aria-pressed="${adminTab === "people"}" class="${adminTab === "people" ? "primary" : ""}">Acesso dos promotores</button>
    <button type="button" id="reload-admin">Atualizar</button>
    ${adminTab === "submissions" ? '<button type="button" id="export-involves" class="primary">Exportar para o Involves (XLSX)</button><button type="button" id="export" class="quiet">Relatório de disponibilidade (CSV)</button>' : ""}</div>
    ${pending ? `<div class="panel flow">
      <label class="field">Data do envio (horário de Brasília)
        <select id="pending-period">${pendingPeriods.map(([key, label]) => `<option value="${key}" ${pendingPeriod === key ? "selected" : ""}>${label}</option>`).join("")}</select>
      </label>
      ${pendingReport ? `<div class="actions" role="status"><span class="tag pending">Pendentes: ${pendingReport.people.length}</span>
        <span class="tag good">Responderam: ${pendingReport.responded}</span><span class="tag">Total com acesso: ${pendingReport.total}</span></div>` : ""}
      <p class="muted">A lista mostra os promotores com lojas vinculadas e acesso ao formulário. A resposta conta depois que o promotor confirma o envio.</p>
    </div>` : ""}
    <label class="field">Buscar <input id="filter" type="search" value="${esc(filter)}" placeholder="${adminTab === "submissions" ? "Promotor, posição, cidade, UF ou loja" : "Promotor ou posição"}"></label>
    <div id="admin-list" class="stores">${items.join("") || `<p class="panel muted">${empty}</p>`}</div>
    ${adminTab === "submissions" && hasNext ? '<button id="more" type="button">Carregar mais</button>' : ""}
  </section>`;
  for (const tab of ["submissions","pending","people"]) {
    $("#" + tab).onclick = (event) => run(event.currentTarget, async () => {
      adminTab = tab;
      filter = "";
      await refreshAdmin();
    });
  }
  $("#reload-admin").onclick = (event) => run(event.currentTarget, refreshAdmin);
  const period = $("#pending-period");
  if (period) period.onchange = () => run(period, async () => {
    pendingPeriod = period.value;
    pendingReport = null;
    renderAdmin();
    await refreshAdmin();
  });
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
    button.onclick = () => showInvolvesExport(true);
  });
  const involvesButton = $("#export-involves");
  if (involvesButton) involvesButton.onclick = () => showInvolvesExport();
}

async function loadSubmissions(before) {
  const page = (await request("admin_list", before ? { before } : {})).submissions;
  submissions = before ? submissions.concat(page) : page;
  hasNext = page.length === 50;
  renderAdmin();
}

async function refreshAdmin() {
  if (adminTab === "submissions") await loadSubmissions();
  else if (adminTab === "pending") {
    const period = pendingPeriod;
    const report = await request("admin_pending", { period });
    if (adminTab === "pending" && period === pendingPeriod) {
      pendingReport = report;
      renderAdmin();
    }
  } else {
    roster = (await request("admin_people")).people;
    renderAdmin();
  }
}

function openDetail(id, button) {
  const item = submissions.find((s) => String(s.id) === id);
  showDrawer(item.promoter, `<p class="schedule-context">Enviado em <strong>${date(item.submitted_at)}</strong> · Dias escolhidos pelo promotor.</p>
    ${weeklySummary(item.stores)}`, true);
  if (!item.read_at) run(button, async () => {
    await request("admin_read", { id });
    item.read_at = new Date().toISOString();
    button.closest("article").querySelector(".tag")?.remove();
  }, $("#drawer-error"));
}

function weeklySummary(stores) {
  const entries = stores.map((store) => ({ store, days: [...new Set((store.days || []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))] }));
  const chosen = entries.filter((entry) => entry.days.length);
  const visits = entries.reduce((total, entry) => total + entry.days.length, 0);
  const weekdays = days.map((name, index) => ({ number: index + 1, name, entries: entries.filter((entry) => entry.days.includes(index + 1)) }))
    .filter((day) => day.number <= 5 || day.entries.length);
  const card = (entry) => `<li class="schedule-store"><strong>${esc(entry.store.name)}</strong><span>${esc(entry.store.city)} / ${esc(entry.store.uf)}<span class="schedule-sector">${esc(entry.store.sector)}</span></span></li>`;
  const missing = entries.filter((entry) => !entry.days.length);
  return `<div class="schedule-totals" aria-label="Resumo da sugestão">
    <div><b>${chosen.length}</b><span>${chosen.length === 1 ? 'loja com dia definido' : 'lojas com dias definidos'}</span></div>
    <div><b>${visits}</b><span>${visits === 1 ? 'visita sugerida' : 'visitas sugeridas'}</span></div>
    <div><b>${weekdays.filter((day) => day.entries.length).length}</b><span>dias com visitas</span></div>
    </div><div class="schedule-week" aria-label="Lojas por dia da semana">${weekdays.map((day) => `<section class="schedule-day${day.entries.length ? '' : ' is-empty'}" aria-labelledby="schedule-day-${day.number}">
      <header><div><span class="schedule-day-short" aria-hidden="true">${day.name.slice(0, 3).toLocaleUpperCase('pt-BR')}</span><h3 id="schedule-day-${day.number}">${esc(day.name)}${day.number <= 5 ? '-feira' : ''}</h3></div><span class="schedule-count">${day.entries.length} ${day.entries.length === 1 ? 'loja' : 'lojas'}</span></header>
      ${day.entries.length ? `<ul>${day.entries.map(card).join('')}</ul>` : '<p class="schedule-empty">Sem loja sugerida neste dia.</p>'}
    </section>`).join('')}</div>
    ${missing.length ? `<section class="schedule-unassigned"><h3>Sem dia definido · ${missing.length} ${missing.length === 1 ? 'loja' : 'lojas'}</h3><p class="muted">Estas lojas foram enviadas sem dia disponível.</p><ul>${missing.map(card).join('')}</ul></section>` : ''}
    <p class="schedule-footnote">Esta é a sugestão enviada pelo promotor. A programação no Involves deve ser conferida separadamente.</p>`;
}

async function loadInvolves() {
  const files = [
    ["fflate", "vendor/fflate-0.8.2.js"],
    ["haraldInvolvesTemplate", "involves-template.js"],
    ["haraldInvolves", "involves.js?v=5"],
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

function showInvolvesExport(test = false) {
  showDrawer(test ? "Testar exportação Involves" : "Exportar para o Involves", `
    <form id="involves-form" class="flow">
      ${test ? '<p class="tag pending">Arquivo com sugestões do perfil de teste.</p>' : ""}
      <label class="field">Data do envio (horário de Brasília)
        <select name="period"><option value="today">Hoje</option><option value="yesterday">Ontem</option>
        <option value="week">Esta semana</option><option value="month">Este mês</option></select>
      </label>
      <p class="muted">O arquivo usa a última sugestão de cada promotor no período. Os dias marcados saem como visitas semanais, com ordem preenchida automaticamente.</p>
      <button class="primary" type="submit">Baixar XLSX do Involves</button>
    </form>`);
  const form = $("#involves-form");
  form.onsubmit = (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      const period = new FormData(form).get("period");
      const exporter = await loadInvolves();
      const [start, end] = exporter.dateRange(period);
      const items = [];
      let before;
      do {
        const { submissions: page } = await request("admin_list", before ? { before } : {});
        for (const item of page) {
          const day = exporter.dayKey(item.submitted_at);
          if (day >= start && day <= end && isTestSuggestion(item) === test) items.push(item);
        }
        before = page.length === 50 && exporter.dayKey(page.at(-1).submitted_at) >= start ? page.at(-1).id : null;
      } while (before);
      const rows = exporter.buildRows(items);
      if (!rows.length) throw Error("Nenhuma sugestão com dias disponíveis nesse período.");
      exporter.download(rows, test);
      if (drawer.contains(form) && drawer.open) drawer.close();
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
