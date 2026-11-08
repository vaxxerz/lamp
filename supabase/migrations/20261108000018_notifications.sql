-- Durable inbox. Future reminders are queued now and become visible at available_at.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_id uuid not null,
  kind text not null,
  title text not null,
  body text not null,
  href text not null check (href like '/lamp/%' or href like '/professor/%'),
  available_at timestamptz not null default now(),
  expires_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox_idx on public.notifications(recipient_id, available_at desc);
create index notifications_entity_idx on public.notifications(entity_id, kind);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
create function public.can_receive_team_notification(p_team uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and (
      (p.role = 'student' and exists(select 1 from public.team_members tm where tm.team_id = p_team and tm.user_id = p.id))
      or (p.role = 'professor' and exists(select 1 from public.teams t join public.courses c on c.id = t.course_id where t.id = p_team and c.kind = 'class' and c.professor_id = p.id))
    )
  );
$$;
revoke all on function public.can_receive_team_notification(uuid, uuid) from public, anon, authenticated;
create function public.can_read_notification(p_team uuid, p_href text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_receive_team_notification(p_team, auth.uid()) and exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and ((p.role = 'professor' and p_href like '/professor/%') or (p.role = 'student' and p_href like '/lamp/%'))
  );
$$;
revoke all on function public.can_read_notification(uuid, text) from public, anon;
grant execute on function public.can_read_notification(uuid, text) to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (
  recipient_id = auth.uid() and public.can_read_notification(team_id, href)
  and available_at <= now() and (expires_at is null or expires_at > now())
);
create policy notifications_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid() and public.can_read_notification(team_id, href) and available_at <= now())
  with check (recipient_id = auth.uid() and public.can_read_notification(team_id, href));

create function public.notify_team(p_team uuid, p_actor uuid, p_entity uuid, p_kind text, p_title text, p_body text, p_href text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(recipient_id, team_id, actor_id, entity_id, kind, title, body, href)
  select recipient.user_id, p_team, p_actor, p_entity, p_kind, p_title, p_body,
    case when recipient.professor then '/professor/teams/' || p_team || '/' ||
      case when p_kind like 'meeting_%' then 'meetings'
           when p_kind like 'document_%' then 'documents'
           when p_kind = 'report_ready' then 'analysis' else 'dashboard' end
      else p_href end
  from (
    select tm.user_id, false as professor from public.team_members tm join public.profiles p on p.id = tm.user_id where tm.team_id = p_team and p.role = 'student'
    union all
    select c.professor_id, true from public.courses c join public.teams t on t.course_id = c.id
      where t.id = p_team and c.kind = 'class' and c.professor_id is not null
  ) recipient
  where recipient.user_id is distinct from p_actor and public.can_receive_team_notification(p_team, recipient.user_id);
$$;
revoke all on function public.notify_team(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

create function public.queue_meeting_reminders(p_meeting uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.notifications where entity_id = p_meeting and kind in ('meeting_day', 'meeting_hour');
  insert into public.notifications(recipient_id, team_id, entity_id, kind, title, body, href, available_at, expires_at)
  select participant.user_id, m.team_id, m.id, r.kind,
    case r.kind when 'meeting_day' then '내일 회의가 있어요' else '곧 회의가 시작돼요' end,
    m.title || ' · ' || to_char(m.held_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || coalesce(' · ' || nullif(m.location, ''), ''),
    case when participant.professor then '/professor/teams/' || m.team_id || '/meetings' else '/lamp/meetings?meeting=' || m.id end,
    greatest(now(), m.held_at - r.lead_time),
    case r.kind when 'meeting_day' then m.held_at - interval '1 hour' else m.held_at end
  from public.meetings m cross join lateral (
    select tm.user_id, false as professor from public.team_members tm join public.profiles p on p.id = tm.user_id where tm.team_id = m.team_id and p.role = 'student'
    union all
    select c.professor_id, true from public.courses c join public.teams t on t.course_id = c.id
      where t.id = m.team_id and c.kind = 'class' and c.professor_id is not null
  ) participant
  cross join (values ('meeting_day', interval '24 hours'), ('meeting_hour', interval '1 hour')) r(kind, lead_time)
  where m.id = p_meeting and m.held_at > now() and public.can_receive_team_notification(m.team_id, participant.user_id)
    and (r.kind = 'meeting_hour' or m.held_at > now() + interval '1 hour');
$$;
revoke all on function public.queue_meeting_reminders(uuid) from public, anon, authenticated;

create function public.notify_task_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  status_name text;
begin
  select name into actor_name from public.profiles where id = actor;
  actor_name := coalesce(actor_name, '팀원');
  if tg_op = 'INSERT' then
    perform public.notify_team(new.team_id, coalesce(actor, new.created_by), new.id, 'task_created', '새 할 일이 추가됐어요', new.title, '/lamp/board?task=' || new.id);
  elsif tg_op = 'DELETE' then
    perform public.notify_team(old.team_id, actor, old.id, 'task_deleted', '할 일이 삭제됐어요', actor_name || ' · ' || old.title, '/lamp/board');
    return old;
  else
    if new.status is distinct from old.status then
      status_name := case new.status when 'todo' then '할 일' when 'doing' then '진행 중' when 'done' then '완료' end;
      perform public.notify_team(new.team_id, actor, new.id, 'task_status', '할 일 상태가 변경됐어요', actor_name || ' · ' || new.title || ' → ' || status_name, '/lamp/board?task=' || new.id);
    end if;
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and new.assignee_id is distinct from actor and public.can_receive_team_notification(new.team_id, new.assignee_id) and exists(select 1 from public.profiles where id = new.assignee_id and role = 'student') then
      insert into public.notifications(recipient_id, team_id, actor_id, entity_id, kind, title, body, href)
      values(new.assignee_id, new.team_id, actor, new.id, 'task_assigned', '담당할 할 일이 생겼어요', new.title, '/lamp/board?task=' || new.id);
    end if;
    if new.verified_by is distinct from old.verified_by and new.status = 'done' then
      perform public.notify_team(new.team_id, actor, new.id, 'task_verified', case when new.verified_by is null then '완료 확인이 취소됐어요' else '할 일 완료가 확인됐어요' end, actor_name || ' · ' || new.title, '/lamp/board?task=' || new.id);
    end if;
    if (new.title, new.description, new.due_date) is distinct from (old.title, old.description, old.due_date) then
      perform public.notify_team(new.team_id, actor, new.id, 'task_edited', '할 일 내용이 수정됐어요', actor_name || ' · ' || new.title, '/lamp/board?task=' || new.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_task_change() from public, anon, authenticated;
create trigger notify_task after insert or update or delete on public.tasks for each row execute function public.notify_task_change();

create function public.notify_meeting_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.notifications where entity_id = old.id and kind in ('meeting_day', 'meeting_hour');
    perform public.notify_team(old.team_id, auth.uid(), old.id, 'meeting_cancelled', '회의가 취소됐어요', old.title, '/lamp/meetings');
    return old;
  end if;
  if tg_op = 'INSERT' then
    perform public.notify_team(new.team_id, coalesce(auth.uid(), new.created_by), new.id, 'meeting_created', '새 회의가 잡혔어요', new.title || ' · ' || to_char(new.held_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), '/lamp/meetings?meeting=' || new.id);
  elsif (new.title, new.held_at, new.location) is not distinct from (old.title, old.held_at, old.location) then
    return new;
  else
    perform public.notify_team(new.team_id, auth.uid(), new.id, 'meeting_changed', '회의 일정이 변경됐어요', new.title || ' · ' || to_char(new.held_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') || coalesce(' · ' || nullif(new.location, ''), ''), '/lamp/meetings?meeting=' || new.id);
  end if;
  perform public.queue_meeting_reminders(new.id);
  return new;
end;
$$;
revoke all on function public.notify_meeting_change() from public, anon, authenticated;
create trigger notify_meeting after insert or update or delete on public.meetings for each row execute function public.notify_meeting_change();

create function public.notify_workspace_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  item_title text;
  item_id uuid;
  item_kind text;
  item_href text;
  heading text;
  recipient uuid;
begin
  case tg_table_name
    when 'external_docs' then
      actor := new.linked_by; item_id := new.id; item_title := new.title;
      item_kind := 'document_connected'; heading := '팀 문서가 연결됐어요'; item_href := '/lamp/documents/' || new.id;
    when 'file_versions' then
      actor := new.uploader_id; item_id := new.file_id;
      select name into item_title from public.files where id = new.file_id;
      item_title := item_title || ' · 버전 ' || new.version;
      item_kind := 'file_uploaded'; heading := '새 파일 버전이 올라왔어요'; item_href := '/lamp/files';
    when 'meeting_comments' then
      actor := new.author_id; item_id := new.meeting_id;
      select title into item_title from public.meetings where id = new.meeting_id;
      item_kind := 'meeting_comment'; heading := '회의에 새 댓글이 달렸어요'; item_href := '/lamp/meetings?meeting=' || new.meeting_id;
    when 'meeting_attendance' then
      if new.status is not distinct from old.status or new.checked_by is null then return new; end if;
      actor := new.checked_by; recipient := new.user_id; item_id := new.meeting_id;
      select title into item_title from public.meetings where id = new.meeting_id;
      item_title := item_title || ' · ' || case new.status when 'present' then '출석' when 'late' then '지각' when 'absent' then '결석' when 'excused' then '사유 있는 불참' else '미확인' end;
      item_kind := 'attendance'; heading := '내 출결이 변경됐어요'; item_href := '/lamp/meetings?meeting=' || new.meeting_id;
    when 'document_revisions' then
      actor := new.author_id; item_id := new.document_id;
      select d.title, case d.kind when 'meeting_note' then '/lamp/meetings' else '/lamp/documents' end into item_title, item_href from public.documents d where d.id = new.document_id;
      item_kind := 'document_edited'; heading := '문서가 수정됐어요';
      if exists (select 1 from public.notifications where entity_id = item_id and kind = item_kind and actor_id = actor and created_at > now() - interval '30 minutes') then return new; end if;
    when 'external_doc_revisions', 'external_doc_suggestions' then
      actor := new.author_id; item_id := new.external_doc_id;
      if actor is null then return new; end if;
      if tg_table_name = 'external_doc_revisions' and tg_op = 'UPDATE' then
        if old.author_id is not distinct from new.author_id then return new; end if;
      end if;
      if tg_table_name = 'external_doc_suggestions' then
        if new.status <> 'accepted' then return new; end if;
        if tg_op = 'UPDATE' and old.status = 'accepted' and old.author_id is not distinct from new.author_id then return new; end if;
      end if;
      select title into item_title from public.external_docs where id = item_id;
      item_kind := 'document_edited'; heading := '팀 문서가 수정됐어요'; item_href := '/lamp/documents/' || item_id;
      if exists (select 1 from public.notifications where entity_id = item_id and kind = item_kind and actor_id = actor and created_at > now() - interval '30 minutes') then return new; end if;
    when 'kudos' then
      actor := new.giver_id; item_id := new.event_id;
      select user_id into recipient from public.activity_events where id = new.event_id;
      item_title := '팀원이 내 활동에 공감을 남겼어요.'; item_kind := 'kudos'; heading := '내 활동에 공감을 받았어요'; item_href := '/lamp/activities';
    when 'ai_reports' then
      if new.scope <> 'team' then return new; end if;
      actor := null; item_id := new.id; recipient := new.user_id;
      item_title := '새 기여 분석 보고서를 확인해 보세요.'; item_kind := 'report_ready'; heading := '분석 보고서가 준비됐어요'; item_href := '/lamp/analysis';
      if new.audience = 'professor' then
        select c.professor_id into recipient from public.courses c join public.teams t on t.course_id = c.id where t.id = new.team_id and c.kind = 'class';
        if recipient is null then return new; end if;
        item_href := '/professor/teams/' || new.team_id || '/analysis';
      end if;
    when 'team_members' then
      actor := new.user_id; item_id := new.user_id;
      select name into item_title from public.profiles where id = new.user_id;
      item_kind := 'member_joined'; heading := '새 팀원이 참여했어요'; item_href := '/lamp/dashboard';
    else return new;
  end case;
  if recipient is null then
    perform public.notify_team(new.team_id, actor, item_id, item_kind, heading, item_title, item_href);
  elsif recipient is distinct from actor and public.can_receive_team_notification(new.team_id, recipient) then
    if exists(select 1 from public.profiles where id = recipient and role = 'professor') then
      item_href := '/professor/teams/' || new.team_id || '/' || case when item_kind = 'attendance' then 'meetings' when item_kind = 'report_ready' then 'analysis' else 'activities' end;
    end if;
    insert into public.notifications(recipient_id, team_id, actor_id, entity_id, kind, title, body, href)
    values(recipient, new.team_id, actor, item_id, item_kind, heading, item_title, item_href);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_workspace_activity() from public, anon, authenticated;
create trigger notify_external_doc after insert on public.external_docs for each row execute function public.notify_workspace_activity();
create trigger notify_file_version after insert on public.file_versions for each row execute function public.notify_workspace_activity();
create trigger notify_meeting_comment after insert on public.meeting_comments for each row execute function public.notify_workspace_activity();
create trigger notify_attendance after update on public.meeting_attendance for each row execute function public.notify_workspace_activity();
create trigger notify_document_revision after insert on public.document_revisions for each row execute function public.notify_workspace_activity();
create trigger notify_external_revision after insert or update of author_id on public.external_doc_revisions for each row execute function public.notify_workspace_activity();
create trigger notify_external_suggestion after insert or update on public.external_doc_suggestions for each row execute function public.notify_workspace_activity();
create trigger notify_kudos after insert on public.kudos for each row execute function public.notify_workspace_activity();
create trigger notify_member_joined after insert on public.team_members for each row execute function public.notify_workspace_activity();
create trigger notify_report_ready after insert on public.ai_reports for each row execute function public.notify_workspace_activity();

-- Include already scheduled meetings; do not announce old activity as new.
do $$ declare m record; begin
  for m in select id from public.meetings where held_at > now() loop
    perform public.queue_meeting_reminders(m.id);
  end loop;
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Reindex the destination column transactionally, including legacy equal positions.
create function public.move_task(p_task uuid, p_status public.task_status, p_before uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_team uuid;
  v_ids uuid[];
  v_index int;
begin
  select team_id into v_team from public.tasks where id = p_task;
  if v_team is null or not public.is_team_member(v_team) then
    raise exception '팀원만 할 일을 이동할 수 있어요' using errcode = '42501';
  end if;
  perform id from public.tasks where team_id = v_team order by id for update;
  if p_before = p_task then return; end if;
  if p_before is not null and not exists (select 1 from public.tasks where id = p_before and team_id = v_team and status = p_status) then
    raise exception '이동 위치가 바뀌었어요. 다시 시도해 주세요' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by position, created_at, id), '{}'::uuid[]) into v_ids
    from public.tasks where team_id = v_team and status = p_status and id <> p_task;
  v_index := coalesce(array_position(v_ids, p_before), cardinality(v_ids) + 1);
  v_ids := coalesce(v_ids[1:v_index-1], '{}'::uuid[]) || array[p_task] || coalesce(v_ids[v_index:cardinality(v_ids)], '{}'::uuid[]);
  update public.tasks set status = p_status where id = p_task;
  update public.tasks t set position = ordered.n
  from unnest(v_ids) with ordinality ordered(id, n) where t.id = ordered.id;
end;
$$;
revoke all on function public.move_task(uuid, public.task_status, uuid) from public, anon;
grant execute on function public.move_task(uuid, public.task_status, uuid) to authenticated;

create function public.queue_task_reminders(p_task uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.notifications where entity_id = p_task and kind in ('task_due_day', 'task_due_today');
  insert into public.notifications(recipient_id, team_id, entity_id, kind, title, body, href, available_at, expires_at)
  select t.assignee_id, t.team_id, t.id, r.kind,
    case r.kind when 'task_due_day' then '내일 마감인 할 일이 있어요' else '오늘 마감인 할 일이 있어요' end,
    t.title || ' · 마감 ' || t.due_date::text, '/lamp/board?task=' || t.id,
    greatest(now(), ((t.due_date - r.days_before) + time '09:00') at time zone 'Asia/Seoul'),
    ((t.due_date + (1 - r.days_before))::timestamp) at time zone 'Asia/Seoul'
  from public.tasks t join public.profiles p on p.id = t.assignee_id and p.role = 'student'
  cross join (values ('task_due_day', 1), ('task_due_today', 0)) r(kind, days_before)
  where t.id = p_task and t.assignee_id is not null and t.status <> 'done' and t.due_date is not null
    and ((t.due_date + (1 - r.days_before))::timestamp) at time zone 'Asia/Seoul' > now();
$$;
revoke all on function public.queue_task_reminders(uuid) from public, anon, authenticated;

create function public.refresh_task_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.notifications where entity_id = old.id and kind in ('task_due_day', 'task_due_today');
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.title, new.due_date, new.assignee_id, new.status) is not distinct from (old.title, old.due_date, old.assignee_id, old.status) then return new; end if;
  end if;
  perform public.queue_task_reminders(new.id);
  return new;
end;
$$;
revoke all on function public.refresh_task_reminders() from public, anon, authenticated;
create trigger task_reminders after insert or update or delete on public.tasks for each row execute function public.refresh_task_reminders();

do $$ declare t record; begin
  for t in select id from public.tasks where due_date is not null and status <> 'done' loop
    perform public.queue_task_reminders(t.id);
  end loop;
end $$;

-- New participants receive reminders for meetings that were already scheduled.
create function public.queue_joined_member_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = new.user_id and role = 'student') then return new; end if;
  insert into public.notifications(recipient_id, team_id, entity_id, kind, title, body, href, available_at, expires_at)
  select distinct on (n.entity_id, n.kind) new.user_id, n.team_id, n.entity_id, n.kind, n.title, n.body, '/lamp/meetings?meeting=' || n.entity_id, n.available_at, n.expires_at
  from public.notifications n
  where n.team_id = new.team_id and n.kind in ('meeting_day', 'meeting_hour') and n.expires_at > now()
    and not exists(select 1 from public.notifications own where own.recipient_id = new.user_id and own.entity_id = n.entity_id and own.kind = n.kind);
  return new;
end;
$$;
revoke all on function public.queue_joined_member_reminders() from public, anon, authenticated;
create trigger joined_member_reminders after insert on public.team_members for each row execute function public.queue_joined_member_reminders();
