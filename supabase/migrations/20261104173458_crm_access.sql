begin;

create schema crm_private;
revoke all on schema crm_private from public, anon, authenticated;
grant usage on schema crm_private to authenticated;

create type public.crm_role as enum ('manager', 'worker');
create type public.task_status as enum ('new', 'in_progress', 'in_review', 'accepted', 'needs_changes');

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (display_name ~ '[^[:space:]]'),
  role public.crm_role not null
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '[^[:space:]]'),
  address text not null check (address ~ '[^[:space:]]'),
  deleted_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.objects(id),
  title text not null check (title ~ '[^[:space:]]'),
  description text not null default '',
  assignee_id uuid not null references public.profiles(id),
  status public.task_status not null default 'new',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);

create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id),
  actor_id uuid not null references public.profiles(id),
  from_status public.task_status,
  to_status public.task_status not null,
  comment text,
  created_at timestamptz not null default clock_timestamp()
);

create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_assignee_object_idx on public.tasks (assignee_id, object_id);
create index task_history_task_id_idx on public.task_history (task_id, id);

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;

revoke all on public.profiles, public.objects, public.tasks, public.task_history from public, anon, authenticated;
grant select on public.profiles, public.objects, public.tasks, public.task_history to authenticated;
grant insert (name, address), update (name, address) on public.objects to authenticated;
grant insert (object_id, title, description, assignee_id),
      update (object_id, title, description, assignee_id) on public.tasks to authenticated;

create function crm_private.current_role() returns public.crm_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- The helper avoids recursion between the task and object SELECT policies.
create function crm_private.object_is_active(p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.objects where id = p_id and deleted_at is null);
$$;

revoke all on function crm_private.current_role(), crm_private.object_is_active(uuid) from public, anon, authenticated;
grant execute on function crm_private.current_role(), crm_private.object_is_active(uuid) to authenticated;

create policy profiles_read on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select crm_private.current_role()) = 'manager'
  or (role = 'manager' and (select crm_private.current_role()) = 'worker')
);

create policy objects_read on public.objects for select to authenticated
using (
  deleted_at is null and (
    (select crm_private.current_role()) = 'manager'
    or ((select crm_private.current_role()) = 'worker'
        and exists (select 1 from public.tasks where object_id = objects.id and assignee_id = (select auth.uid())))
  )
);

create policy objects_create on public.objects for insert to authenticated
with check ((select crm_private.current_role()) = 'manager' and deleted_at is null);

create policy objects_edit on public.objects for update to authenticated
using ((select crm_private.current_role()) = 'manager' and deleted_at is null)
with check ((select crm_private.current_role()) = 'manager' and deleted_at is null);

create policy tasks_read on public.tasks for select to authenticated
using (
  deleted_at is null and crm_private.object_is_active(object_id) and (
    (select crm_private.current_role()) = 'manager'
    or ((select crm_private.current_role()) = 'worker' and assignee_id = (select auth.uid()))
  )
);

create policy tasks_create on public.tasks for insert to authenticated
with check (
  (select crm_private.current_role()) = 'manager'
  and created_by = (select auth.uid()) and status = 'new' and deleted_at is null
  and crm_private.object_is_active(object_id)
);

create policy tasks_edit on public.tasks for update to authenticated
using (
  (select crm_private.current_role()) = 'manager' and deleted_at is null
  and crm_private.object_is_active(object_id)
)
with check (
  (select crm_private.current_role()) = 'manager' and deleted_at is null
  and crm_private.object_is_active(object_id)
);

create policy history_read on public.task_history for select to authenticated
using (exists (select 1 from public.tasks where id = task_history.task_id));

-- The shared locks serialize task writes with object archiving.
create function crm_private.validate_task_details() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_locked integer;
  v_expected integer := 1;
  v_previous_object uuid := new.object_id;
begin
  if tg_op = 'UPDATE' then
    v_previous_object := old.object_id;
    if old.object_id <> new.object_id then v_expected := 2; end if;
  end if;
  perform id from public.objects
  where id in (v_previous_object, new.object_id) and deleted_at is null
  order by id for share;
  get diagnostics v_locked = row_count;
  if v_locked <> v_expected then
    raise exception using errcode = 'PT404', message = 'Объект недоступен.';
  end if;
  if not exists (select 1 from public.profiles where id = new.assignee_id and role = 'worker') then
    raise exception using errcode = 'PT400', message = 'Выберите исполнителя.';
  end if;
  return new;
end;
$$;

revoke all on function crm_private.validate_task_details() from public, anon, authenticated;
create trigger task_details_valid before insert or update of object_id, assignee_id, title, description
on public.tasks for each row execute function crm_private.validate_task_details();

create function crm_private.archive_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_object_id uuid;
begin
  if (select crm_private.current_role()) is distinct from 'manager' then
    raise exception using errcode = '42501', message = 'Удаление доступно постановщику.';
  end if;

  if p_kind = 'object' then
    update public.objects set deleted_at = clock_timestamp() where id = p_id and deleted_at is null;
    if found then return; end if;
  elsif p_kind = 'task' then
    select object_id into v_object_id from public.tasks where id = p_id and deleted_at is null for update;
    if found then
      perform id from public.objects where id = v_object_id and deleted_at is null for share;
      if found then
        update public.tasks set deleted_at = clock_timestamp() where id = p_id;
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = 'PT404', message = 'Запись недоступна или уже удалена.';
end;
$$;

create function public.archive_item(p_kind text, p_id uuid) returns void
language sql security invoker set search_path = ''
as $$ select crm_private.archive_item(p_kind, p_id); $$;

revoke all on function crm_private.archive_item(text, uuid), public.archive_item(text, uuid) from public, anon, authenticated;
grant execute on function crm_private.archive_item(text, uuid), public.archive_item(text, uuid) to authenticated;

commit;
