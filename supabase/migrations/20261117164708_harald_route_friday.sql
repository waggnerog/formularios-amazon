-- Keep the official visit limit and accept suggestions from Monday to Friday.
create or replace function harald_route.valid_visit_days(selected_days jsonb, weekly_visits numeric)
returns boolean language sql immutable security invoker
set search_path = pg_catalog
as $validate$
  select case
    when jsonb_typeof(selected_days) is distinct from 'array'
      or weekly_visits is null or weekly_visits not in (1,2,3,4,5) then false
    when jsonb_array_length(selected_days) > weekly_visits then false
    else (
      select count(*) = count(distinct day) and count(*) filter (where day::text !~ '^[1-5]$') = 0
      from jsonb_array_elements(selected_days) as choices(day)
    )
  end
$validate$;

revoke all on function harald_route.valid_visit_days(jsonb,numeric) from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('harald_route.call(text,jsonb)'::regprocedure);
  previous_message text := 'Escolha dias de segunda a quinta, até o limite semanal da loja.';
  current_message text := 'Escolha dias de segunda a sexta, até o limite semanal da loja.';
begin
  if strpos(definition, previous_message) > 0 then
    execute replace(definition, previous_message, current_message);
  elsif strpos(definition, current_message) = 0 then
    raise exception 'Mensagem de validação de roteiro não encontrada.';
  end if;
end
$migration$;
