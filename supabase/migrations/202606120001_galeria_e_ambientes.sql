-- Estrutura complementar em portugues para suportar galeria e a nomenclatura de ambientes.
-- Mantem compatibilidade com as tabelas existentes em ingles ja usadas pela aplicacao.

create table if not exists public.galerias (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,
  entidade_tipo text not null
    check (entidade_tipo in (
      'edificacao',
      'ambiente',
      'ativo',
      'subcomponente',
      'manutencao',
      'substituicao'
    )),
  entidade_id uuid not null,
  arquivo_url text not null,
  legenda text,
  ordem integer not null default 0,
  propriedades jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists galerias_building_idx
  on public.galerias(building_id);

create index if not exists galerias_entidade_idx
  on public.galerias(entidade_tipo, entidade_id, ordem);

create trigger galerias_set_updated_at
before update on public.galerias
for each row execute function public.set_updated_at();

alter table public.galerias enable row level security;
revoke all on table public.galerias from anon, authenticated;
grant select, insert, update, delete on table public.galerias to authenticated;

create policy "galerias_owner_all"
on public.galerias for all
to authenticated
using (
  owner_id = (select auth.uid())
  and (
    building_id is null
    or exists (
      select 1
      from public.buildings building
      where building.id = galerias.building_id
        and building.owner_id = (select auth.uid())
    )
  )
)
with check (
  owner_id = (select auth.uid())
  and (
    building_id is null
    or exists (
      select 1
      from public.buildings building
      where building.id = galerias.building_id
        and building.owner_id = (select auth.uid())
    )
  )
);

create or replace view public.ambientes as
select
  id,
  building_id,
  source_model_location_id,
  parent_id,
  name,
  location_type as tipo_ambiente,
  sort_order as ordem,
  properties as propriedades,
  created_at,
  updated_at
from public.locations;

grant select on public.ambientes to authenticated;
