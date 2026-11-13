begin;

create table harald_route.test_stores (
  cpf text not null check (cpf = '00000000000'),
  source_row integer primary key,
  promoter_name text not null,
  store_key text not null unique,
  sector_code text not null check (sector_code = 'TESTE'),
  store_name text not null,
  city text not null,
  state_code text not null,
  store_address text not null,
  weekly_visits numeric not null,
  days_week1 text not null,
  days_week2 text not null,
  expires_at timestamptz not null
);
alter table harald_route.test_stores enable row level security;
revoke all on harald_route.test_stores from public, anon, authenticated;

alter view harald_route.verified_stores rename to official_verified_stores;

create view harald_route.verified_stores as
select * from harald_route.official_verified_stores where cpf <> '00000000000'
union all
select cpf, 'teste-roteiro'::text as source_version, source_row, promoter_name, store_key,
       sector_code, store_name, city, state_code, store_address, weekly_visits, days_week1, days_week2
from harald_route.test_stores
where expires_at > now();

revoke all on harald_route.verified_stores from public, anon, authenticated;

commit;
