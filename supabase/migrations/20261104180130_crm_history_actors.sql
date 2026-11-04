begin;

-- Let the current assignee identify past actors in the history they can read.
create index task_history_actor_id_idx on public.task_history (actor_id);

create policy profiles_read_visible_history_actors on public.profiles
for select to authenticated
using (
  (select crm_private.current_role()) = 'worker'
  and exists (select 1 from public.task_history where actor_id = profiles.id)
);

commit;
