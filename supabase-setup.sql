-- Portal de Campo | Amazon Devices
-- Execute este arquivo inteiro no SQL Editor de um projeto Supabase vazio.
-- Ele pode ser executado novamente com seguranca para atualizar as politicas.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid(),
  form_key text not null check (form_key in (
    'overview-carrefour', 'alexa-kindle-week', 'atestados', 'manutencao',
    'fact-card', 'overview-vivo', 'overview-claro', 'overview-fast-shop',
    'concorrencia-vivo', 'concorrencia-fast-shop'
  )),
  form_title text not null,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'complete')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  form_key text not null,
  field_key text not null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200),
  created_at timestamptz not null default now(),
  unique (submission_id, field_key)
);

-- Compatibilidade caso a primeira versao do prototipo ja tenha sido executada.
alter table public.submissions add column if not exists public_token uuid not null default gen_random_uuid();
alter table public.submissions add column if not exists status text not null default 'pending';
alter table public.submissions add column if not exists submitted_at timestamptz;
alter table public.submissions alter column id set default gen_random_uuid();

create index if not exists submissions_status_created_idx
  on public.submissions (status, created_at desc);
create index if not exists submissions_form_created_idx
  on public.submissions (form_key, created_at desc);
create index if not exists attachments_submission_idx
  on public.attachments (submission_id);

alter table public.admin_users enable row level security;
alter table public.submissions enable row level security;
alter table public.attachments enable row level security;

-- Retira privilegios genericos. O publico envia somente pelas funcoes abaixo.
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;
revoke all on table public.attachments from anon, authenticated;
grant select, delete on table public.submissions to authenticated;
grant select, delete on table public.attachments to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists admin_read_submissions on public.submissions;
create policy admin_read_submissions on public.submissions
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists admin_delete_submissions on public.submissions;
create policy admin_delete_submissions on public.submissions
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists admin_read_attachments on public.attachments;
create policy admin_read_attachments on public.attachments
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists admin_delete_attachments on public.attachments;
create policy admin_delete_attachments on public.attachments
  for delete to authenticated
  using ((select public.is_admin()));

-- Cria uma resposta pendente e reserva caminhos privados para os anexos.
-- Nao ha INSERT publico direto nas tabelas.
create or replace function public.create_submission(
  p_form_key text,
  p_answers jsonb,
  p_files jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission_id uuid := gen_random_uuid();
  v_public_token uuid := gen_random_uuid();
  v_title text;
  v_file jsonb;
  v_attachment_id uuid;
  v_field text;
  v_name text;
  v_mime text;
  v_size bigint;
  v_path text;
  v_required text[];
  v_uploads jsonb := '[]'::jsonb;
begin
  v_title := case p_form_key
    when 'overview-carrefour' then 'Formulário Semanal — Overview Carrefour'
    when 'alexa-kindle-week' then 'Avaliação de Campo — Alexa Week & Kindle Week'
    when 'atestados' then 'Envio de Atestados de Campo'
    when 'manutencao' then 'Solicitação de Manutenção | Expositores Amazon'
    when 'fact-card' then 'Evidência de Troca de Fact Card — Echo Show 8'
    when 'overview-vivo' then 'Formulário Semanal — Overview Vivo'
    when 'overview-claro' then 'Formulário Semanal — Overview Claro'
    when 'overview-fast-shop' then 'Formulário Semanal — Overview Fast Shop'
    when 'concorrencia-vivo' then 'Monitoramento de Concorrência — Vivo'
    when 'concorrencia-fast-shop' then 'Monitoramento de Concorrência — Fast Shop'
    else null
  end;

  if v_title is null then raise exception 'Formulario invalido'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Respostas invalidas';
  end if;
  if octet_length(p_answers::text) > 100000 then
    raise exception 'Conteudo da resposta excede o limite';
  end if;
  if exists (
    select 1 from jsonb_each(p_answers)
    where jsonb_typeof(value) <> 'string' or char_length(value #>> '{}') > 5000
  ) then
    raise exception 'Os campos devem conter somente texto dentro dos limites permitidos';
  end if;

  v_required := case p_form_key
    when 'overview-carrefour' then array['consultor','highlights','lowlights','impacto']
    when 'overview-vivo' then array['consultor','highlights','lowlights','impacto']
    when 'overview-claro' then array['consultor','highlights','lowlights','impacto']
    when 'overview-fast-shop' then array['consultor','highlights','lowlights','impacto']
    when 'alexa-kindle-week' then array['consultor','rede','loja','acao','rebaixa','vendedores_percepcao','vendedores_comentarios','clientes_percepcao','clientes_reacao','gerou_vendas','impacto_vendas','efetividade','avaliacao_final']
    when 'atestados' then array['nome','data_documento']
    when 'manutencao' then array['consultor','data_solicitacao','loja','cnpj','endereco','bairro','cidade','uf','cep','problema']
    when 'fact-card' then array['loja','trocado']
    when 'concorrencia-vivo' then array['consultor','data','loja','cidade','uf','marca','acao','descricao','objetivo','reacao_vendedores','feedback','venda_dia','venda_periodo','impacto_periodo','impacto_amazon','impacto_amazon_detalhe']
    when 'concorrencia-fast-shop' then array['consultor','data','loja','cidade','uf','marca','acao','descricao','objetivo','reacao_vendedores','feedback','venda_dia','venda_periodo','impacto_periodo','impacto_amazon','impacto_amazon_detalhe']
    else array[]::text[]
  end;
  foreach v_field in array v_required loop
    if not (p_answers ? v_field) or nullif(trim(p_answers->>v_field), '') is null then
      raise exception 'Campo obrigatorio ausente: %', v_field;
    end if;
  end loop;

  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 4 then
    raise exception 'Lista de arquivos invalida';
  end if;

  insert into public.submissions (id, public_token, form_key, form_title, answers)
  values (v_submission_id, v_public_token, p_form_key, v_title, p_answers);

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    v_field := nullif(trim(v_file->>'field_key'), '');
    v_name := left(nullif(trim(v_file->>'original_name'), ''), 200);
    v_mime := lower(nullif(trim(v_file->>'mime_type'), ''));
    begin
      v_size := (v_file->>'size_bytes')::bigint;
    exception when others then
      raise exception 'Tamanho de arquivo invalido';
    end;

    if v_field is null or v_name is null or v_mime is null or v_size is null or v_size <= 0 then
      raise exception 'Metadados de arquivo invalidos';
    end if;

    if not (
      (p_form_key in ('overview-carrefour','overview-vivo','overview-claro','overview-fast-shop')
        and v_field in ('evidencia1','evidencia2','evidencia3','evidencia4')
        and (v_mime like 'image/%' or v_mime = 'application/pdf')
        and v_size <= 15728640)
      or (p_form_key = 'atestados' and v_field = 'pdf'
        and v_mime = 'application/pdf' and v_size <= 15728640)
      or (p_form_key = 'manutencao' and v_field in ('foto1','foto2','foto3')
        and v_mime like 'image/%' and v_size <= 15728640)
      or (p_form_key = 'manutencao' and v_field = 'video'
        and v_mime like 'video/%' and v_size <= 209715200)
      or (p_form_key = 'fact-card' and v_field in ('foto1','foto2')
        and v_mime like 'image/%' and v_size <= 15728640)
    ) then
      raise exception 'Arquivo nao permitido para este campo';
    end if;

    v_attachment_id := gen_random_uuid();
    v_path := v_submission_id::text || '/' || v_field || '/' || v_attachment_id::text;

    insert into public.attachments (
      id, submission_id, form_key, field_key, storage_path,
      original_name, mime_type, size_bytes
    ) values (
      v_attachment_id, v_submission_id, p_form_key, v_field, v_path,
      v_name, v_mime, v_size
    );

    v_uploads := v_uploads || jsonb_build_array(jsonb_build_object(
      'field_key', v_field,
      'storage_path', v_path
    ));
  end loop;

  if p_form_key = 'atestados' and not exists (
    select 1 from public.attachments where submission_id = v_submission_id and field_key = 'pdf'
  ) then raise exception 'O PDF e obrigatorio'; end if;

  if p_form_key = 'fact-card' and (
    select count(*) from public.attachments
    where submission_id = v_submission_id and field_key in ('foto1','foto2')
  ) <> 2 then raise exception 'As duas fotos sao obrigatorias'; end if;

  if p_form_key = 'manutencao' and (
    select count(*) from public.attachments
    where submission_id = v_submission_id and field_key in ('foto1','foto2','foto3','video')
  ) <> 4 then raise exception 'As tres fotos e o video sao obrigatorios'; end if;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'public_token', v_public_token,
    'uploads', v_uploads
  );
end;
$$;

revoke all on function public.create_submission(text, jsonb, jsonb) from public;
grant execute on function public.create_submission(text, jsonb, jsonb) to anon, authenticated;

-- O Storage aceita somente caminhos previamente reservados por create_submission.
create or replace function public.is_expected_upload(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attachments a
    join public.submissions s on s.id = a.submission_id
    where a.storage_path = p_storage_path
      and s.status = 'pending'
      and s.created_at > now() - interval '2 hours'
  );
$$;

revoke all on function public.is_expected_upload(text) from public;
grant execute on function public.is_expected_upload(text) to anon, authenticated;

-- So conclui a resposta quando todos os anexos reservados chegaram ao bucket.
create or replace function public.complete_submission(
  p_submission_id uuid,
  p_public_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing integer;
begin
  if not exists (
    select 1 from public.submissions
    where id = p_submission_id
      and public_token = p_public_token
      and status = 'pending'
      and created_at > now() - interval '2 hours'
  ) then
    raise exception 'Envio invalido ou expirado';
  end if;

  select count(*) into v_missing
  from public.attachments a
  left join storage.objects o
    on o.bucket_id = 'field-evidence' and o.name = a.storage_path
  where a.submission_id = p_submission_id and o.id is null;

  if v_missing > 0 then
    raise exception 'Existem arquivos que ainda nao foram enviados';
  end if;

  update public.submissions
  set status = 'complete', submitted_at = now()
  where id = p_submission_id and public_token = p_public_token;

  return true;
end;
$$;

revoke all on function public.complete_submission(uuid, uuid) from public;
grant execute on function public.complete_submission(uuid, uuid) to anon, authenticated;

-- Bucket privado: 200 MB por arquivo e somente os formatos utilizados no portal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'field-evidence',
  'field-evidence',
  false,
  209715200,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf',
    'video/mp4','video/quicktime','video/webm','video/x-m4v'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 209715200,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists public_upload_field_evidence on storage.objects;
create policy public_upload_field_evidence on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'field-evidence'
    and (select public.is_expected_upload(name))
  );

drop policy if exists admin_read_field_evidence on storage.objects;
create policy admin_read_field_evidence on storage.objects
  for select to authenticated
  using (
    bucket_id = 'field-evidence'
    and (select public.is_admin())
  );

drop policy if exists admin_delete_field_evidence on storage.objects;
create policy admin_delete_field_evidence on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'field-evidence'
    and (select public.is_admin())
  );

-- Depois de criar o usuario em Authentication > Users, torne-o administrador:
-- insert into public.admin_users(user_id) values ('UUID_DO_USUARIO')
-- on conflict (user_id) do nothing;
