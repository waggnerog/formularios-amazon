create table harald_route.involves_pdv_aliases (
  store_key text not null,
  pdv_name text not null,
  primary key (store_key,pdv_name)
);

create table harald_route.involves_route_batches (
  environment text primary key check (environment in ('SAZONAL','PADRAO')),
  file_name text not null,
  revision bigint not null check (revision > 0),
  published_at timestamptz not null default now(),
  published_by uuid,
  rows jsonb not null check (jsonb_typeof(rows)='array')
);

alter table harald_route.involves_pdv_aliases enable row level security;
alter table harald_route.involves_route_batches enable row level security;
revoke all on harald_route.involves_pdv_aliases, harald_route.involves_route_batches from public, anon, authenticated;

create function harald_route.involves_route_read() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.harald_members where user_id=(select auth.uid())) then
    raise exception 'Acesso restrito ao Console HARALD.';
  end if;

  return (
    select jsonb_build_object(
      'batches',coalesce(jsonb_agg(jsonb_build_object(
        'environment',b.environment,'file_name',b.file_name,'revision',b.revision,
        'published_at',b.published_at,'rows',p.rows,
        'unlinked',jsonb_array_length(b.rows)-jsonb_array_length(p.rows)
      ) order by b.environment),'[]'::jsonb),
      'active_people',(select count(distinct lower(promoter_name))
        from public.harald_horista_console_rows where is_current and nullif(btrim(promoter_name),'') is not null)
    )
    from harald_route.involves_route_batches b
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'promoter',c.promoter_name, 'phone',c.phone, 'sector',c.sector_code,
        'store',c.store_name,'pdv',x.pdv,'city',c.city,'uf',c.state_code,
        'days',x.days
      ) order by c.promoter_name,c.sector_code,c.store_name),'[]'::jsonb) as rows
      from jsonb_to_recordset(b.rows) x(store_key text,promoter text,pdv text,days integer[])
      join harald_route.official_verified_stores v
        on v.store_key=x.store_key and lower(btrim(v.promoter_name))=lower(btrim(x.promoter))
      join public.harald_horista_console_rows c
        on c.is_current and c.source_version=v.source_version and c.source_row=v.source_row
    ) p
  );
end
$$;

create function harald_route.involves_route_replace(p_environment text, p_file_name text, p_rows jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  previous_revision bigint;
  matches jsonb;
  missing text;
begin
  if not exists (select 1 from public.harald_members where user_id=(select auth.uid()) and role='admin') then
    raise exception 'Somente a coordenação pode atualizar os roteiros.';
  end if;
  if p_environment is null or p_environment not in ('SAZONAL','PADRAO')
    or p_file_name is null or length(p_file_name)>180 or p_file_name !~* '\.xlsx?$'
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Arquivo ou ambiente inválido.';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'O arquivo deve ter de 1 a 1000 linhas de roteiro.';
  end if;

  perform pg_advisory_xact_lock(47626,20261117);
  select revision into previous_revision from harald_route.involves_route_batches where environment=p_environment;
  previous_revision:=coalesce(previous_revision,0);
  if previous_revision is distinct from p_expected_revision then
    raise exception 'Este roteiro foi atualizado em outra sessão. Atualize a tela e selecione o arquivo novamente.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) x(line integer,promoter text,pdv text,days integer[])
    where x.line is null or nullif(btrim(x.promoter),'') is null or nullif(btrim(x.pdv),'') is null
      or cardinality(x.days) is distinct from 7
      or not exists(select 1 from unnest(x.days) d where d is not null)
      or exists(select 1 from unnest(x.days) d where d not between 1 and 1000)
  ) then raise exception 'O arquivo tem linha sem colaborador, PDV ou sequência de dias válida.'; end if;

  with input as (
    select * from jsonb_to_recordset(p_rows) x(line integer,promoter text,pdv text,days integer[])
  ), resolved as (
    select x.*,m.store_key,m.official_name,m.weekly_visits
    from input x left join lateral (
      select min(v.store_key) as store_key,min(v.promoter_name) as official_name,min(v.weekly_visits) as weekly_visits
      from harald_route.official_verified_stores v
      where lower(btrim(v.promoter_name))=lower(btrim(x.promoter))
      and (lower(btrim(v.store_name))=lower(btrim(x.pdv)) or exists (
        select 1 from harald_route.involves_pdv_aliases a where a.store_key=v.store_key
        and lower(btrim(a.pdv_name))=lower(btrim(x.pdv))
      ))
      having count(*)=1
    ) m on true
  )
  select jsonb_agg(jsonb_build_object('store_key',store_key,'promoter',official_name,'pdv',pdv,'days',days) order by line),
    min(concat('Linha ',line,' · ',promoter,' · ',pdv))
      filter (where store_key is null or weekly_visits is null or
        (select count(*) from unnest(days) d where d is not null)>weekly_visits)
  into matches,missing from resolved;

  if missing is not null then
    raise exception '% — vínculo não confirmado na base oficial ou frequência acima da Sistemática.',missing;
  end if;
  if exists (select 1 from jsonb_array_elements(matches) x group by x->>'store_key' having count(*)>1) then
    raise exception 'O arquivo contém a mesma loja e setor mais de uma vez.';
  end if;
  if exists (
    select 1 from harald_route.involves_route_batches b, jsonb_array_elements(b.rows) existing,
      jsonb_array_elements(matches) incoming
    where b.environment<>p_environment and existing->>'store_key'=incoming->>'store_key'
  ) then raise exception 'Uma loja deste arquivo já consta no outro ambiente. Confira o ambiente do arquivo.'; end if;

  if exists (
    select 1 from jsonb_to_recordset(matches) x(promoter text,days integer[])
    cross join lateral unnest(x.days) with ordinality d(rank, weekday)
    where d.rank is not null
    group by x.promoter,d.weekday
    having count(*)<>count(distinct d.rank) or min(d.rank)<>1 or max(d.rank)<>count(*)
  ) then raise exception 'A ordem diária precisa começar em 1 e seguir sem repetição para cada promotor.'; end if;

  insert into harald_route.involves_route_batches(environment,file_name,rows,published_by,revision)
  values(p_environment,p_file_name,matches,(select auth.uid()),previous_revision+1)
  on conflict(environment) do update set file_name=excluded.file_name,rows=excluded.rows,
    revision=excluded.revision,published_by=excluded.published_by,published_at=excluded.published_at;
  return harald_route.involves_route_read();
end
$$;

create function public.harald_involves_route_read() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select harald_route.involves_route_read()
$$;

create function public.harald_involves_route_replace(p_environment text,p_file_name text,p_rows jsonb,p_expected_revision bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select harald_route.involves_route_replace(p_environment,p_file_name,p_rows,p_expected_revision)
$$;

revoke all on function harald_route.involves_route_read(),public.harald_involves_route_read(),
  harald_route.involves_route_replace(text,text,jsonb,bigint),public.harald_involves_route_replace(text,text,jsonb,bigint)
  from public, anon, authenticated;
grant execute on function harald_route.involves_route_read(),public.harald_involves_route_read(),
  harald_route.involves_route_replace(text,text,jsonb,bigint),public.harald_involves_route_replace(text,text,jsonb,bigint)
  to authenticated;
