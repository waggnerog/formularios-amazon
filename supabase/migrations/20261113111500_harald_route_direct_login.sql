create or replace function harald_route.call(action text, data jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog
as $fn$
declare
  doc text;
  pw text;
  token text;
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
  denial constant jsonb := '{"error":"CPF ou senha inválidos."}';
begin
  if action is null then return '{"error":"Ação inválida."}'; end if;
  if octet_length(data::text) > 16000 then return '{"error":"Dados acima do limite."}'; end if;
  if action in ('admin_list','admin_people','admin_read','admin_count') then
    if not exists(select 1 from public.harald_members where user_id=auth.uid() and role='admin') then
      return '{"error":"Acesso restrito à coordenação."}';
    end if;
    if action = 'admin_count' then
      return jsonb_build_object('unread',(select count(*) from harald_route.submissions where read_at is null));
    elsif action = 'admin_people' then
      return jsonb_build_object('people',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from (
        select min(s.promoter_name) as name,
          string_agg(distinct s.sector_code, ', ' order by s.sector_code) as sectors,
          count(*) as stores, 'Liberado'::text as access
        from harald_route.verified_stores s
        group by s.cpf
      ) p),'[]'::jsonb));
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

  if action='login' then
    doc := btrim(coalesce(data->>'cpf',''));
    pw := data->>'password';
    if doc !~ '^[0-9]{11}$' or pw is null or octet_length(pw)>72 then return denial; end if;
    insert into harald_route.attempts as a(bucket,since,tries)
      values (extensions.digest(doc,'sha256'),now(),1)
      on conflict(bucket) do update set
        since=case when a.since < now()-interval '15 minutes' then now() else a.since end,
        tries=case when a.since < now()-interval '15 minutes' then 1 else least(a.tries+1,9) end
      returning tries into n;
    if n>8 then return '{"error":"Muitas tentativas. Aguarde 15 minutos."}'; end if;
    if pw <> '123456' or not exists (
      select 1 from harald_route.verified_stores where cpf=doc
    ) then
      return denial;
    end if;
    -- Provision the draft account on demand from the current official link.
    insert into harald_route.accounts(cpf) values (doc) on conflict (cpf) do nothing;
    delete from harald_route.attempts where bucket=extensions.digest(doc,'sha256');
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
