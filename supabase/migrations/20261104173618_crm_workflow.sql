begin;

create function crm_private.record_task_creation() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.task_history (task_id, actor_id, from_status, to_status, created_at)
  values (new.id, new.created_by, null, new.status, new.created_at);
  return new;
end;
$$;

revoke all on function crm_private.record_task_creation() from public, anon, authenticated;

-- Prevent an insert between the backfill and trigger installation.
lock table public.tasks in share row exclusive mode;
insert into public.task_history (task_id, actor_id, from_status, to_status, created_at)
select id, created_by, null, 'new', created_at from public.tasks;

create trigger task_created after insert on public.tasks
for each row execute function crm_private.record_task_creation();

create function crm_private.change_task_status(
  p_task_id uuid, p_new_status public.task_status, p_comment text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.crm_role := crm_private.current_role();
  v_task public.tasks%rowtype;
  v_comment text := nullif(regexp_replace(p_comment, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
begin
  if v_actor is null or v_role is null then
    raise exception using errcode = '42501', message = 'Войдите в CRM с назначенной ролью.';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id and deleted_at is null
    and (v_role = 'manager' or assignee_id = v_actor)
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Задача недоступна.';
  end if;

  perform id from public.objects where id = v_task.object_id and deleted_at is null for share;
  if not found then
    raise exception using errcode = 'PT404', message = 'Задача недоступна.';
  end if;

  if p_new_status is null or not (
    (v_role = 'worker' and (
      (v_task.status in ('new', 'needs_changes') and p_new_status = 'in_progress')
      or (v_task.status = 'in_progress' and p_new_status = 'in_review')
    ))
    or (v_role = 'manager' and v_task.status = 'in_review' and p_new_status in ('accepted', 'needs_changes'))
  ) then
    raise exception using errcode = 'PT409', message = 'Этот переход сейчас недоступен. Обновите карточку задачи.';
  end if;

  if p_new_status = 'needs_changes' and v_comment is null then
    raise exception using errcode = 'PT400', message = 'Укажите комментарий для доработки.';
  end if;

  update public.tasks set status = p_new_status where id = p_task_id;
  insert into public.task_history (task_id, actor_id, from_status, to_status, comment)
  values (p_task_id, v_actor, v_task.status, p_new_status, v_comment);
end;
$$;

create function public.change_task_status(
  p_task_id uuid, p_new_status public.task_status, p_comment text default null
) returns void
language sql security invoker set search_path = ''
as $$ select crm_private.change_task_status(p_task_id, p_new_status, p_comment); $$;

revoke all on function crm_private.change_task_status(uuid, public.task_status, text),
  public.change_task_status(uuid, public.task_status, text) from public, anon, authenticated;
grant execute on function crm_private.change_task_status(uuid, public.task_status, text),
  public.change_task_status(uuid, public.task_status, text) to authenticated;

commit;
