-- Publish the workspace tables missing from earlier Realtime migrations.
-- Existing SELECT policies continue to govern delivery; no permissions are expanded.
do $$
declare
  relation_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach relation_name in array array[
      'profiles', 'courses', 'course_members', 'teams', 'team_members',
      'meetings', 'files', 'file_versions', 'document_revisions'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = relation_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', relation_name);
      end if;
    end loop;
  end if;
end
$$;
