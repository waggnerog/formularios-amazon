import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase-setup.sql", import.meta.url), "utf8");

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(inlineScripts.length, 1, "o portal deve ter um único script inline principal");

const source = inlineScripts[0][1]
  .replace(/home\(\);route\(\);\s*$/, "")
  .concat("\nglobalThis.__FORMS__ = FORMS;");
const context = {
  console,
  crypto: globalThis.crypto,
  supabase: { createClient: () => ({}) },
  window: { addEventListener() {}, scrollTo() {} },
  location: { hash: "#/" },
};
const localValues = new Map();
context.localStorage = {
  getItem: (key) => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: (key) => localValues.delete(key),
};
vm.createContext(context);
new vm.Script(source, { filename: "index-inline.js" }).runInContext(context);

assert.equal(context.__FORMS__.length, 10, "devem existir exatamente 10 formulários");
const maintenance = context.__FORMS__.find((form) => form.key === "manutencao");
assert.ok(maintenance, "formulário de manutenção ausente");
assert.equal(
  JSON.stringify(maintenance.fields.filter((field) => field.t === "file" && field.req).map((field) => field.k)),
  JSON.stringify(["foto1", "foto2", "foto3", "video"]),
  "manutenção deve exigir 3 fotos e 1 vídeo",
);

vm.runInContext('adminSubmissions=[{id:"antiga"}];updateAdminUnseenState();globalThis.__FIRST_UNSEEN__=[...adminUnseenIds];', context);
assert.equal(JSON.stringify(context.__FIRST_UNSEEN__), "[]", "primeiro acesso deve criar a referência sem marcar o histórico como novo");
vm.runInContext('adminSubmissions=[{id:"nova"},{id:"antiga"}];updateAdminUnseenState();globalThis.__NEXT_UNSEEN__=[...adminUnseenIds];', context);
assert.equal(JSON.stringify(context.__NEXT_UNSEEN__), '["nova"]', "uma nova resposta deve permanecer destacada até ser marcada como vista");

for (const expected of [
  "create or replace function public.create_submission",
  "create or replace function public.complete_submission",
  "create or replace function private.is_admin",
  "create or replace function private.is_expected_upload",
  "create policy public_upload_field_evidence",
  "create policy admin_read_submissions",
  "revoke all on table public.submissions from anon, authenticated",
]) assert.ok(sql.includes(expected), `regra ausente no SQL: ${expected}`);

assert.ok(!/service[_ -]?role/i.test(html), "uma chave service role nunca pode ir para o HTML");
assert.ok(!/sb_secret_/i.test(html), "uma chave secreta nunca pode ir para o HTML");

const supabaseUrl = html.match(/const SUPABASE_URL = "([^"]+)";/)?.[1];
const supabaseKey = html.match(/const SUPABASE_ANON_KEY = "([^"]+)";/)?.[1];
assert.match(
  supabaseUrl ?? "",
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i,
  "URL pública do Supabase ausente ou inválida",
);
assert.ok(
  /^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(supabaseKey ?? ""),
  "chave pública do Supabase ausente ou inválida",
);
assert.ok(html.includes('sb.rpc("create_submission"'), "frontend deve criar envios pela função protegida");
assert.ok(html.includes('sb.rpc("complete_submission"'), "frontend deve concluir envios pela função protegida");
assert.ok(html.includes("MAINTENANCE_DRAFT_KEY"), "manutenção deve preservar o rascunho no dispositivo");
assert.ok(html.includes("loadMaintenanceAttempt"), "manutenção deve recuperar arquivos já enviados");
assert.ok(html.includes("HD/720p, com até 30 segundos"), "formulário deve orientar um vídeo mais leve");
assert.ok(html.includes("ADMIN_SEEN_KEY"), "admin deve registrar respostas já vistas");
assert.ok(html.includes("adminUnseenIds"), "admin deve destacar respostas novas");
assert.ok(html.includes("#/admin/submission/"), "admin deve preservar a resposta aberta no F5");
assert.ok(html.includes("ADMIN_UI_STATE_KEY"), "admin deve preservar os filtros no F5");
assert.ok(html.includes("Content-Security-Policy"), "política de conteúdo ausente");
assert.ok(html.includes("@supabase/supabase-js@2.116.0"), "cliente Supabase deve usar versão fixa");

console.log("Verificação concluída: 10 formulários, JavaScript válido e contrato de segurança presente.");
