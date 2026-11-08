-- Apply the score cap to a whole revision and keep surviving editors' event IDs on reallocation.

create or replace function public.credit_external_credit(p_credit_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  c public.external_doc_credits%rowtype;
  r public.external_doc_revisions%rowtype;
  d public.external_docs%rowtype;
  v_author uuid;
  v_amount numeric;
begin
  select revision.* into r
  from public.external_doc_revisions revision
  join public.external_doc_credits credit on credit.revision_id = revision.id
  where credit.id = p_credit_id
  for update of revision;
  if not found then return false; end if;
  select * into c from public.external_doc_credits where id = p_credit_id;
  if not found then return false; end if;
  select * into d from public.external_docs where id = r.external_doc_id;

  v_author := coalesce(c.author_id, public.resolve_google_member(c.team_id, c.person_id, c.permission_id));
  if v_author is null then return false; end if;
  if c.author_id is null then
    update public.external_doc_credits set author_id = v_author where id = c.id;
  end if;

  -- Include unmatched editors so their share is reserved if they connect later.
  -- Round cumulative amounts so the distributed cents add up to the cap exactly.
  with weights as (
    select id, round(chars_added + 0.5 * chars_removed) as amount
    from public.external_doc_credits where revision_id = c.revision_id
  ), totals as (
    select id, amount, sum(amount) over () as total,
           sum(amount) over (order by id rows unbounded preceding) as through_editor
    from weights
  )
  select case when total <= 3000 then amount
              else round(3000 * through_editor / total) - round(3000 * (through_editor - amount) / total)
         end
    into v_amount from totals where id = c.id;

  if v_amount > 0 or exists (
    select 1 from public.activity_events
    where type = 'external_doc_edit' and ref_table = 'external_doc_credits' and ref_id = c.id and user_id = v_author
  ) then
    perform public.record_event(c.team_id, v_author, public.external_category(d.mime_type),
      'external_doc_edit', v_amount, 'external_doc_credits', c.id,
      jsonb_build_object('provider', 'google', 'external_doc_id', d.id, 'title', d.title,
                         'web_url', d.web_url, 'modified_at', r.modified_at, 'revision_id', r.id,
                         'source', r.source, 'confidence', c.confidence, 'share', c.share,
                         'chars_added', c.chars_added, 'chars_removed', c.chars_removed));
  end if;
  return true;
end
$$;

create or replace function public.replace_revision_credits(p_revision_id uuid, p_credits jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.external_doc_revisions%rowtype;
  x record;
  v_credit uuid;
  v_author uuid;
  v_kept uuid[] := '{}';
begin
  select * into r from public.external_doc_revisions where id = p_revision_id for update;
  if not found then return; end if;

  if p_credits is null then
    p_credits := jsonb_build_array(jsonb_build_object(
      'permission_id', r.google_permission_id, 'display_name', r.google_display_name,
      'chars_added', r.chars_added, 'chars_removed', r.chars_removed, 'share', 1, 'confidence', 'fallback'));
  end if;

  for x in
    select person_id, permission_id, display_name, confidence, edited_from, edited_to,
           greatest(coalesce(chars_added, 0), 0) as chars_added,
           greatest(coalesce(chars_removed, 0), 0) as chars_removed,
           least(greatest(coalesce(share, 0), 0), 1) as share
    from jsonb_to_recordset(p_credits)
      as input(person_id text, permission_id text, display_name text,
               chars_added int, chars_removed int, share numeric, confidence text,
               edited_from timestamptz, edited_to timestamptz)
  loop
    v_author := public.resolve_google_member(r.team_id, x.person_id, x.permission_id);
    -- Match by the team member across permissionId fallback and Activity person IDs.
    select c.id into v_credit from public.external_doc_credits c
    where c.revision_id = r.id and c.id <> all(v_kept)
      and (v_author is null or c.author_id is null or c.author_id = v_author)
      and (c.author_id = v_author
           or (c.person_id is not distinct from x.person_id
               and (x.person_id is not null or c.permission_id is not distinct from x.permission_id)))
    order by (c.author_id = v_author) desc nulls last, c.id
    limit 1;

    if v_credit is null then
      insert into public.external_doc_credits
        (revision_id, team_id, author_id, person_id, permission_id, display_name,
         chars_added, chars_removed, share, confidence, edited_from, edited_to)
      values (r.id, r.team_id, v_author, x.person_id, x.permission_id, x.display_name,
              x.chars_added, x.chars_removed, x.share, x.confidence, x.edited_from, x.edited_to)
      returning id into v_credit;
    else
      update public.external_doc_credits
         set author_id = coalesce(v_author, author_id),
             person_id = x.person_id, permission_id = x.permission_id, display_name = x.display_name,
             chars_added = x.chars_added, chars_removed = x.chars_removed, share = x.share,
             confidence = x.confidence, edited_from = x.edited_from, edited_to = x.edited_to
       where id = v_credit;
    end if;
    v_kept := array_append(v_kept, v_credit);
  end loop;

  delete from public.activity_events
   where type = 'external_doc_edit' and ref_table = 'external_doc_credits'
     and ref_id in (select id from public.external_doc_credits where revision_id = r.id and id <> all(v_kept));
  delete from public.external_doc_credits where revision_id = r.id and id <> all(v_kept);

  -- Calculate points once the complete allocation is stored.
  foreach v_credit in array v_kept loop
    perform public.credit_external_credit(v_credit);
  end loop;

  update public.external_doc_revisions
     set author_id = (select author_id from public.external_doc_credits
                       where revision_id = r.id and author_id is not null
                       order by share desc, chars_added desc limit 1)
   where id = r.id;
end
$$;

-- Correct over-cap totals already stored, updating events in place so kudos survive.
do $$
declare
  v_credit uuid;
begin
  for v_credit in
    select c.id from public.external_doc_credits c
    join (
      select revision_id from public.external_doc_credits group by revision_id
      having sum(round(chars_added + 0.5 * chars_removed)) > 3000
    ) capped using (revision_id)
    where c.author_id is not null
  loop
    perform public.credit_external_credit(v_credit);
  end loop;
end
$$;
