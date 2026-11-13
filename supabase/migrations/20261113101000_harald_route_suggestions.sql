begin;

create schema if not exists harald_route;
revoke all on schema harald_route from public;
grant usage on schema harald_route to anon, authenticated;

create table harald_route.accounts (
  cpf text primary key check (cpf ~ '^[0-9]{11}$'),
  password_hash text,
  invite_hash bytea,
  invite_until timestamptz,
  entered_name text,
  draft jsonb not null default '{}'::jsonb,
  latest_submission bigint
);
create table harald_route.sessions (
  token_hash bytea primary key,
  cpf text not null references harald_route.accounts(cpf) on delete cascade,
  expires_at timestamptz not null
);
create index on harald_route.sessions(cpf);
create index on harald_route.sessions(expires_at);
create table harald_route.attempts (
  bucket bytea primary key,
  since timestamptz not null,
  tries integer not null
);
create table harald_route.submissions (
  id bigint generated always as identity primary key,
  cpf text not null references harald_route.accounts(cpf),
  promoter text not null,
  entered_name text not null,
  stores jsonb not null,
  submitted_at timestamptz not null default now(),
  read_at timestamptz
);
create index on harald_route.submissions(submitted_at desc, id desc);
create index on harald_route.submissions(id) where read_at is null;

alter table harald_route.accounts enable row level security;
alter table harald_route.sessions enable row level security;
alter table harald_route.attempts enable row level security;
alter table harald_route.submissions enable row level security;

-- The workbook publishes one CPF anchor for a person, with more rows for their stores.
-- Require an unambiguous name and corroboration by position, email, or phone.
create view harald_route.verified_stores as
with current_rows as materialized (
  select c.*,
    lower(regexp_replace(btrim(c.promoter_name), '\s+', ' ', 'g')) as person_key,
    nullif(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g'), '') as phone_key,
    nullif(lower(btrim(c.email)), '') as email_key,
    regexp_replace(c.cnpj, '[^0-9]', '', 'g') as tax_digits
  from public.harald_horista_console_rows c
  where c.is_current and c.model = 'HORISTA' and c.sector_code like 'GH2-%'
    and nullif(btrim(c.promoter_name),'') is not null
),
anchors as (
  select c.person_key, c.sector_code, c.phone_key, c.email_key, regexp_replace(p.cpf,'[^0-9]','','g') as cpf
  from current_rows c join public.harald_horista_private_rows p using (source_version, source_row)
  where p.is_current and p.sector_code = c.sector_code
    and lower(regexp_replace(btrim(p.promoter_name), '\s+', ' ', 'g')) = c.person_key
    and length(regexp_replace(p.cpf,'[^0-9]','','g')) = 11
),
matched as (
  select c.source_version, c.source_row, min(a.cpf) as cpf
  from current_rows c join anchors a on a.person_key = c.person_key
  group by c.source_version, c.source_row
  having count(distinct a.cpf) = 1
    and bool_or(c.sector_code = a.sector_code or c.phone_key = a.phone_key or c.email_key = a.email_key)
),
valid_stores as (
  select m.cpf, c.*,
    c.sector_code || '/' || lpad(c.tax_digits,14,'0') as store_key
  from matched m join current_rows c using (source_version, source_row)
  where length(c.tax_digits) between 12 and 14 and nullif(btrim(c.store_name),'') is not null
    and (select count(distinct a.person_key) from anchors a where a.cpf = m.cpf) = 1
)
select cpf, source_version, source_row, promoter_name, store_key, sector_code,
       store_name, city, state_code, store_address, weekly_visits, days_week1, days_week2
from (select v.*,count(*) over(partition by store_key) as key_count from valid_stores v) s
where key_count=1;

create function harald_route.call(action text, data jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $fn$
declare
  doc text;
  pw text;
  token text;
  code text;
  store_id text;
  payload jsonb;
  stores jsonb;
  signature text;
  current_name text;
  status jsonb;
  saved harald_route.accounts%rowtype;
  n integer;
  submission_id bigint;
  before_id bigint;
  before_time timestamptz;
  denial constant jsonb := '{"error":"CPF, senha ou código inválido."}';
begin
  if action is null then return '{"error":"Ação inválida."}'; end if;
  if octet_length(data::text) > 16000 then return '{"error":"Dados acima do limite."}'; end if;
  if action in ('admin_list','admin_people','admin_invite','admin_read','admin_count') then
    if not exists(select 1 from public.harald_members where user_id=auth.uid() and role='admin') then
      return '{"error":"Acesso restrito à coordenação."}';
    end if;
    if action = 'admin_count' then
      return jsonb_build_object('unread',(select count(*) from harald_route.submissions where read_at is null));
    elsif action = 'admin_people' then
      return jsonb_build_object('people',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from (
        select min(s.source_row) as ref, min(s.source_version) as version, min(s.promoter_name) as name,
          string_agg(distinct s.sector_code, ', ' order by s.sector_code) as sectors, count(*) as stores,
          case when a.password_hash is not null then 'Ativo'
               when a.invite_until > now() then 'Código gerado' else 'Aguardando ativação' end as access
        from harald_route.verified_stores s left join harald_route.accounts a on a.cpf=s.cpf
        group by s.cpf,a.password_hash,a.invite_until
      ) p),'[]'::jsonb));
    elsif action = 'admin_invite' then
      select s.cpf into doc from harald_route.verified_stores s
      where s.source_version=data->>'version' and s.source_row::text=data->>'ref';
      if doc is null then return '{"error":"O cadastro mudou. Atualize a lista."}'; end if;
      code := encode(extensions.gen_random_bytes(12),'hex');
      insert into harald_route.accounts(cpf,invite_hash,invite_until)
        values (doc,extensions.digest(code,'sha256'),now()+interval '7 days')
        on conflict (cpf) do update set invite_hash=excluded.invite_hash, invite_until=excluded.invite_until;
      return jsonb_build_object('code',code);
    elsif action = 'admin_read' then
      update harald_route.submissions set read_at=now()
      where id::text=data->>'id' and read_at is null;
      return '{"ok":true}';
    end if;
    if data->>'before' ~ '^[0-9]{1,18}$' then
      before_id := (data->>'before')::bigint;
      select submitted_at into before_time from harald_route.submissions where id=before_id;
      if not found then return '{"error":"Página indisponível. Atualize a lista."}'; end if;
    end if;
    return jsonb_build_object('submissions',coalesce((select jsonb_agg(to_jsonb(p) order by submitted_at desc,id desc) from (
      select id, promoter, entered_name, s.stores, submitted_at, read_at
      from harald_route.submissions s
      where before_id is null or (submitted_at,id)<(before_time,before_id)
      order by submitted_at desc,id desc limit 50
    ) p),'[]'::jsonb));
  end if;

  if action in ('login','activate') then
    doc := regexp_replace(coalesce(data->>'cpf',''),'[^0-9]','','g');
    pw := data->>'password';
    if length(doc)<>11 or pw is null or octet_length(pw)>72 then return denial; end if;
    insert into harald_route.attempts as a(bucket,since,tries)
      values (extensions.digest(doc,'sha256'),now(),1)
      on conflict(bucket) do update set
        since=case when a.since < now()-interval '15 minutes' then now() else a.since end,
        tries=case when a.since < now()-interval '15 minutes' then 1 else least(a.tries+1,9) end
      returning tries into n;
    if n>8 then return '{"error":"Muitas tentativas. Aguarde 15 minutos."}'; end if;
    select * into saved from harald_route.accounts where cpf=doc for update;
    if action='activate' then
      code := lower(btrim(coalesce(data->>'code','')));
      if pw <> '123456' or code !~ '^[0-9a-f]{24}$' or saved.invite_until is null or saved.invite_until<=now()
          or saved.invite_hash is distinct from extensions.digest(code,'sha256') then return denial; end if;
      pw := data->>'new_password';
      if pw is null or length(pw)<15 or octet_length(pw)>72 or pw ~ '^([[:alnum:]])\1+$' then
        return '{"error":"Use uma senha de 15 a 72 caracteres, evitando sequências repetidas."}';
      end if;
      if not exists(select 1 from harald_route.verified_stores where cpf=doc) then
        return '{"error":"Nenhuma loja vinculada. Fale com a coordenação."}';
      end if;
      update harald_route.accounts set password_hash=extensions.crypt(pw,extensions.gen_salt('bf',10)),
        invite_hash=null, invite_until=null where cpf=doc;
      delete from harald_route.sessions where cpf=doc;
    else
      -- A fixed valid bcrypt hash gives unknown accounts the same verification cost.
      if extensions.crypt(pw,coalesce(saved.password_hash,'$2a$10$KfEaYwf2BUm0z3If11iE0uPFn/RAN1OQdEisN63qmHTm8lmdp/c7W'))
          is distinct from saved.password_hash or saved.password_hash is null then return denial; end if;
    end if;
    delete from harald_route.attempts where bucket=extensions.digest(doc,'sha256');
    if not exists(select 1 from harald_route.verified_stores where cpf=doc) then
      return '{"error":"Nenhuma loja vinculada. Fale com a coordenação."}';
    end if;
    token := encode(extensions.gen_random_bytes(32),'hex');
    delete from harald_route.sessions where expires_at<=now();
    insert into harald_route.sessions values (extensions.digest(token,'sha256'),doc,now()+interval '12 hours');
    return jsonb_build_object('token',token);
  end if;

  token := data->>'token';
  if token is null or token !~ '^[0-9a-f]{64}$' then return '{"error":"Entre novamente.","expired":true}'; end if;
  select cpf into doc from harald_route.sessions where token_hash=extensions.digest(token,'sha256') and expires_at>now();
  if doc is null then return '{"error":"Sua sessão expirou. Entre novamente.","expired":true}'; end if;
  if action='logout' then
    delete from harald_route.sessions where token_hash=extensions.digest(token,'sha256');
    return '{"ok":true}';
  end if;

  select * into saved from harald_route.accounts where cpf=doc for update;
  select min(promoter_name),jsonb_agg(jsonb_build_object(
    'id',store_key,'sector',sector_code,'name',store_name,'city',city,'uf',state_code,
    'address',store_address,'visits',weekly_visits,'week1',days_week1,'week2',days_week2
  ) order by sector_code,store_name,store_key)
  into current_name,stores from harald_route.verified_stores where cpf=doc;
  if stores is null then return '{"error":"Nenhuma loja vinculada. Fale com a coordenação."}'; end if;
  signature := encode(extensions.digest(stores::text,'sha256'),'hex');

  if action='name' then
    if saved.latest_submission is not null then return '{"error":"Inicie uma nova sugestão para editar."}'; end if;
    current_name := btrim(coalesce(data->>'name',''));
    if length(current_name) not between 2 and 150 then return '{"error":"Informe seu nome completo."}'; end if;
    update harald_route.accounts set entered_name=current_name where cpf=doc returning * into saved;
  elsif action='save' then
    if saved.latest_submission is not null then return '{"error":"Inicie uma nova sugestão para editar."}'; end if;
    store_id := data->>'store';
    if data->>'signature' is distinct from signature or not exists (
      select 1 from jsonb_array_elements(stores) s where s->>'id'=store_id
    ) then return '{"error":"Seu vínculo de lojas mudou. Atualize a página antes de continuar."}'; end if;
    payload := data->'days';
    if payload is null or jsonb_typeof(payload)<>'array' then return '{"error":"Selecione os dias disponíveis."}'; end if;
    if jsonb_array_length(payload)>7 or exists(select 1 from jsonb_array_elements(payload) d where d::text !~ '^[1-7]$')
       or jsonb_array_length(payload)<>(select count(distinct d) from jsonb_array_elements(payload) d) then
      return '{"error":"Selecione dias válidos."}';
    end if;
    update harald_route.accounts set draft=jsonb_set(draft,array[store_id],payload) where cpf=doc returning * into saved;
  elsif action='revise' then
    if saved.latest_submission is not null and saved.latest_submission::text=data->>'submission' then
      update harald_route.accounts set latest_submission=null where cpf=doc returning * into saved;
    end if;
  elsif action='submit' and saved.latest_submission is null then
    if data->>'signature' is distinct from signature then
      return '{"error":"Seu roteiro mudou. Atualize a página e revise as lojas."}';
    end if;
    if saved.entered_name is null or exists(select 1 from jsonb_array_elements(stores) s where not (saved.draft ? (s->>'id'))) then
      return '{"error":"Preencha a disponibilidade de todas as lojas antes de enviar."}';
    end if;
    select jsonb_agg(s.value || jsonb_build_object('days',saved.draft->(s.value->>'id')) order by s.ord)
      into payload from jsonb_array_elements(stores) with ordinality s(value,ord);
    insert into harald_route.submissions(cpf,promoter,entered_name,stores)
      values(doc,current_name,saved.entered_name,payload) returning id into submission_id;
    update harald_route.accounts set latest_submission=submission_id where cpf=doc returning * into saved;
  elsif action not in ('state','submit') then
    return '{"error":"Ação inválida."}';
  end if;

  if saved.latest_submission is not null then
    select jsonb_build_object('id',s.id,'at',s.submitted_at) into status
      from harald_route.submissions s where s.id=saved.latest_submission;
  end if;
  select coalesce(jsonb_object_agg(s->>'id',saved.draft->(s->>'id')),'{}'::jsonb)
    into payload from jsonb_array_elements(stores) s where saved.draft ? (s->>'id');
  return jsonb_build_object('name',saved.entered_name,'stores',stores,'draft',payload,'signature',signature,'submitted',status);
end
$fn$;

revoke all on function harald_route.call(text,jsonb) from public;
grant execute on function harald_route.call(text,jsonb) to anon, authenticated;

create function public.harald_route_suggestions(action text, data jsonb default '{}'::jsonb)
returns jsonb language sql volatile security invoker
set search_path = pg_catalog
as $$ select harald_route.call(action,data) $$;
revoke all on function public.harald_route_suggestions(text,jsonb) from public;
grant execute on function public.harald_route_suggestions(text,jsonb) to anon, authenticated;

commit;
