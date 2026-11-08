// DB 로직·RLS 검증 (Docker 없이 PGlite로 Supabase 환경을 흉내냄)
// 실행: npm i -D @electric-sql/pglite@0.2.17  →  node supabase/tests/db.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const MIG = process.argv[2] ?? new URL('../migrations', import.meta.url).pathname;
const db = new PGlite();

const stub = `
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema public, storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create publication supabase_realtime;
`;
await db.exec(stub);
for (const f of fs.readdirSync(MIG).sort()) {
  try { await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); console.log('applied', f); }
  catch (e) { console.error('FAILED', f, e.message); process.exit(1); }
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? '  ✓' : '  ✗', m); };
async function as(uid, sql, params = []) {
  const role = uid === 'service' ? 'service_role' : 'authenticated';
  const claims = uid === 'service' ? { role: 'service_role' } : { sub: uid, role: 'authenticated' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`); }
}
async function expectErr(p, m) { try { await p; ok(false, m + ' (no error)'); } catch (e) { ok(true, `${m} → ${e.message}`); } }

// users — 한양대 구글 로그인 (provider=google, @hanyang.ac.kr). 교수는 허용 목록으로.
const signup = (email, provider = 'google', userMeta = {}, appMeta = {}) => db.query(
  `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`,
  [email, userMeta, { provider, ...appMeta }]).then(r => r.rows[0].id);
const mk = async (name) => signup(`${name}@hanyang.ac.kr`, 'google', { full_name: name });
await db.query(`insert into professor_emails (email) values ('김교수@hanyang.ac.kr')`);
const prof = await mk('김교수');
const [s1, s2, s3, s4, s5] = [await mk('민성'), await mk('왕유'), await mk('신환'), await mk('무임승차'), await mk('타팀')];
ok((await db.query(`select role, name from profiles where id=$1`, [prof])).rows[0].role === 'professor', '허용 목록 이메일은 교수로 가입');
ok((await db.query(`select role, name from profiles where id=$1`, [s1])).rows[0].name === '민성', '구글 이름(full_name)으로 프로필 생성');

console.log('\n[한양대 로그인]');
await expectErr(signup('someone@gmail.com'), '한양대 외 구글 계정 가입 차단');
await expectErr(signup('fake@hanyang.ac.kr', 'email'), '이메일/비번으로 한양대 주소 사칭 가입 차단');
await expectErr(signup('x@hanyang.ac.kr.evil.com'), '도메인 꼬리 붙이기 차단');
const hacker = await signup('hacker@hanyang.ac.kr', 'google', { role: 'professor' });
ok((await db.query(`select role from profiles where id=$1`, [hacker])).rows[0].role === 'student', '메타데이터로 교수 사칭 불가 (학생으로 가입)');
await expectErr(signup('sneaky@demo.lamp', 'email', {}, { demo: true, role: 'professor' }), '데모 표시를 위조한 가입 차단 (허용 목록에 없음)');
await db.query(`insert into demo_accounts (email, role) values ('professor@demo.lamp','professor'), ('student1@demo.lamp','student')`);
const demoProf = await signup('professor@demo.lamp', 'email');
const demoStu = await signup('student1@demo.lamp', 'email', { full_name: '데모학생' });
ok((await db.query(`select role from profiles where id=$1`, [demoProf])).rows[0].role === 'professor'
  && (await db.query(`select role from profiles where id=$1`, [demoStu])).rows[0].role === 'student', '관리자가 만든 데모 계정은 비번 로그인 허용');
const late = await mk('늦게등록된교수');
await db.query(`insert into professor_emails (email) values ('늦게등록된교수@hanyang.ac.kr')`);
ok((await db.query(`select role from profiles where id=$1`, [late])).rows[0].role === 'professor', '나중에 허용 목록에 추가하면 교수로 승격');
await expectErr(as(s1, `select * from professor_emails`), '학생은 교수 허용 목록 조회 불가');
await expectErr(as(s1, `insert into demo_accounts (email, role) values ('me@x.com','professor')`), '학생은 데모 허용 목록 추가 불가');

console.log('\n[과목/팀]');
await expectErr(as(s1, `insert into courses (professor_id,name,semester) values ($1,'x','2026-2')`, [s1]), '학생은 과목 생성 불가');
const course = (await as(prof, `insert into courses (professor_id,name,semester) values ($1,'소프트웨어공학','2026-2') returning id, invite_code`, [prof]))[0];
for (const s of [s1, s2, s3, s4, s5]) await as(s, `select join_course($1)`, [course.invite_code.toLowerCase()]);
await expectErr(as(prof, `select join_course($1)`, [course.invite_code]), '교수는 join_course 불가');
const teamA = (await as(s1, `select create_team($1,'A팀') as id`, [course.id]))[0].id;
for (const s of [s2, s3, s4]) await as(s, `select join_team($1)`, [teamA]);
const teamB = (await as(s5, `select create_team($1,'B팀') as id`, [course.id]))[0].id;
await expectErr(as(s4, `select join_team($1)`, [teamB]), '과목당 한 팀만');
ok((await as(s1, `select * from teams`)).length === 2, '수강생은 과목 내 팀 목록 열람');

console.log('\n[태스크]');
const t1 = (await as(s1, `insert into tasks (team_id,title,assignee_id) values ($1,'자료조사',$2) returning id`, [teamA, s2]))[0].id;
await expectErr(as(s1, `insert into tasks (team_id,title,assignee_id) values ($1,'x',$2)`, [teamA, s5]), '타팀원은 담당자 불가');
await expectErr(as(prof, `insert into tasks (team_id,title) values ($1,'x')`, [teamA]), '교수는 태스크 생성 불가(읽기전용)');
await as(s2, `update tasks set status='done' where id=$1`, [t1]);
let ev = await db.query(`select points, meta from activity_events where type='task_complete' and ref_id=$1`, [t1]);
ok(ev.rows[0]?.points == 1.5, `완료(미확인) 1.5점 → ${ev.rows[0]?.points}`);
await expectErr(as(s2, `update tasks set verified_by=$2 where id=$1`, [t1, s2]), '본인 완료 자기확인 불가');
await expectErr(as(s3, `update tasks set verified_by=$2 where id=$1`, [t1, s4]), '타인 명의 확인 불가');
await as(s3, `update tasks set verified_by=$2 where id=$1`, [t1, s3]);
ev = await db.query(`select points from activity_events where type='task_complete' and ref_id=$1`, [t1]);
ok(ev.rows[0]?.points == 3, `팀원 확인 후 3점 → ${ev.rows[0]?.points}`);
await expectErr(as(s2, `update tasks set completed_by=$2 where id=$1`, [t1, s4]), 'completed_by 직접 수정 불가(컬럼권한)');
const t2 = (await as(s1, `insert into tasks (team_id,title,assignee_id,status) values ($1,'발표연습',$2,'done') returning id`, [teamA, s1]))[0].id;
await as(s1, `update tasks set status='doing' where id=$1`, [t2]);
ok((await db.query(`select 1 from activity_events where type='task_complete' and ref_id=$1`, [t2])).rows.length === 0, '완료 취소 시 이벤트 삭제');
await as(s1, `update tasks set status='done' where id=$1`, [t2]);
await as(s3, `update tasks set verified_by=$2 where id=$1`, [t2, s3]);

console.log('\n[문서]');
const doc = (await as(s1, `insert into documents (team_id,title,content,content_text,version) values ($1,'보고서','{"x":1}','해킹',99) returning id, version, content_text`, [teamA]))[0];
ok(doc.version === 1 && doc.content_text === '', '클라 생성 시 내용/버전 강제 초기화');
await expectErr(as(s1, `update documents set content_text='hack' where id=$1`, [doc.id]), '클라이언트 내용 직접 수정 불가');
await expectErr(as(s1, `select save_document($1,$2,1,'{}','a',1,0,0)`, [doc.id, s1]), '학생은 save_document 직접 호출 불가');
let r = (await as('service', `select save_document($1,$2,1,'{"t":1}',$3,800,0,0) as r`, [doc.id, s1, 'a'.repeat(800)]))[0].r;
ok(r.version === 2, 'save v2');
r = (await as('service', `select save_document($1,$2,2,'{"t":2}',$3,400,0,300) as r`, [doc.id, s1, 'a'.repeat(1200)]))[0].r;
const revs = await db.query(`select chars_added, pasted_chars from document_revisions where document_id=$1`, [doc.id]);
ok(revs.rows.length === 1 && revs.rows[0].chars_added === 1200, `1분 내 같은 작성자 병합 → ${JSON.stringify(revs.rows)}`);
ev = await db.query(`select amount, points from activity_events where ref_id=$1`, [r.revision_id]);
ok(ev.rows[0].amount == 990, `유효글자(900 + 붙여넣기 300×0.3) = 990 → ${ev.rows[0].amount}, ${ev.rows[0].points}점`);
await expectErr(as('service', `select save_document($1,$2,2,'{}','b',1,0,0)`, [doc.id, s3]), '버전 충돌 감지');
await expectErr(as('service', `select save_document($1,$2,3,'{}','b',1,0,0)`, [doc.id, s5]), '타팀원 저장 불가');
await as('service', `select save_document($1,$2,3,'{}',$3,2000,100,0)`, [doc.id, s3, 'b'.repeat(2000)]);
ok((await db.query(`select count(*)::int c from document_revisions where document_id=$1`, [doc.id])).rows[0].c === 2, '다른 작성자는 새 revision');

console.log('\n[회의]');
const mt = (await as(s3, `insert into meetings (team_id,title,location) values ($1,'1차 회의','ITBT 301호') returning id, document_id`, [teamA]))[0];
ok(!!mt.document_id, '회의록 문서 자동 생성');
const roster = await as(s1, `select user_id, status from meeting_attendance where meeting_id=$1`, [mt.id]);
ok(roster.length === 4 && roster.every(r => r.status === 'unchecked'), '회의 생성 시 팀원 4명 출결 행 자동 생성(unchecked)');
const setAtt = (by, u, status, comment = null) =>
  as(by, `update meeting_attendance set status=$3, comment=coalesce($4, comment) where meeting_id=$1 and user_id=$2`, [mt.id, u, status, comment]);
await setAtt(s3, s1, 'present', '자료조사 결과 발표');
await setAtt(s3, s2, 'late', '20분 지각');
await setAtt(s1, s3, 'present', '회의 진행 · 회의록 작성');
await setAtt(s3, s4, 'absent', '연락 두절');
await expectErr(setAtt(s4, s4, 'present'), '본인 출결 직접 체크 불가');
await as(s4, `update meeting_attendance set comment='아파서 못 감' where meeting_id=$1 and user_id=$2`, [mt.id, s4]);
const r4 = (await as(prof, `select status, comment, comment_by, checked_by from meeting_attendance where meeting_id=$1 and user_id=$2`, [mt.id, s4]))[0];
ok(r4.status === 'absent' && r4.comment === '아파서 못 감' && r4.comment_by === s4 && r4.checked_by === s3,
  '본인은 사유 코멘트만 수정, 체크자/코멘트 작성자 기록 & 교수 열람');
await expectErr(as(s1, `update meeting_attendance set checked_by=$3 where meeting_id=$1 and user_id=$2`, [mt.id, s2, s1]), 'checked_by 직접 수정 불가');
await expectErr(as(prof, `update meeting_attendance set status='present' where meeting_id=$1 and user_id=$2 returning 1`, [mt.id, s4]).then(r => { if (!r.length) throw new Error('0 rows (RLS)'); }), '교수는 출결 수정 불가');
await expectErr(as(s3, `insert into meeting_attendance (meeting_id,user_id) values ($1,$2)`, [mt.id, s5]), '타팀원 출결 추가 불가');
ev = await db.query(`select user_id, points from activity_events where type='meeting_attend' and ref_id=$1 order by points`, [mt.id]);
ok(ev.rows.length === 3 && ev.rows[0].points == 0.5 && ev.rows[0].user_id === s2, `출석 1점·지각 0.5점·결석 0점 → ${ev.rows.map(r => r.points)}`);
await setAtt(s1, s2, 'excused');
ok((await db.query(`select 1 from activity_events where type='meeting_attend' and ref_id=$1 and user_id=$2`, [mt.id, s2])).rows.length === 0, '사유 불참으로 바꾸면 출석 이벤트 삭제');
await setAtt(s1, s2, 'late');
await as(s2, `insert into meeting_comments (meeting_id, body) values ($1, '다음 회의는 목요일 7시')`, [mt.id]);
await expectErr(as(s5, `insert into meeting_comments (meeting_id, body) values ($1, 'x')`, [mt.id]), '타팀 회의 코멘트 불가');
const cm = (await as(prof, `select id, author_id, team_id from meeting_comments where meeting_id=$1`, [mt.id]))[0];
ok(cm?.author_id === s2 && cm?.team_id === teamA, '회의 코멘트 작성 & 교수 열람');
ok((await as(s1, `update meeting_comments set body='수정' where id=$1 returning 1`, [cm.id])).length === 0, '남의 코멘트 수정 불가');
const mt2 = (await as(s1, `insert into meetings (team_id,title) values ($1,'2차 회의') returning id`, [teamA]))[0];
for (const [u, st] of [[s1, 'present'], [s2, 'present'], [s3, 'present'], [s4, 'absent']])
  await as(u === s1 ? s2 : s1, `update meeting_attendance set status=$3 where meeting_id=$1 and user_id=$2`, [mt2.id, u, st]);
const att = await as(prof, `select name, meetings_total, present, late, absent, excused, attendance_rate from get_team_attendance($1)`, [teamA]);
console.table(att);
ok(Number(att.find(a => a.name === '무임승차').attendance_rate) === 0 && Number(att.find(a => a.name === '왕유').attendance_rate) === 75,
  '출석률: 무임승차 0%, 왕유(지각1+출석1) 75%');
ok((await as(s5, `select * from get_team_attendance($1)`, [teamA])).length === 0, '타팀은 출결 조회 불가');
await as('service', `select save_document($1,$2,1,'{}',$3,1500,0,0)`, [mt.document_id, s3, 'c'.repeat(1500)]);
ok((await db.query(`select category from activity_events where type='meeting_note'`)).rows[0]?.category === 'meeting', '회의록 편집은 meeting 카테고리');
await expectErr(as(s1, `update meetings set document_id=$2 where id=$1`, [mt.id, doc.id]), '회의 document_id 변경 불가');

console.log('\n[파일]');
await as(s2, `insert into storage.objects (bucket_id,name) values ('team-files',$1)`, [`${teamA}/발표자료.pptx/v1`]);
await expectErr(as(s5, `insert into storage.objects (bucket_id,name) values ('team-files',$1)`, [`${teamA}/x/v1`]), '타팀 폴더 업로드 불가');
ok((await as(s5, `select * from storage.objects`)).length === 0, '타팀 파일 열람 불가');
await as('service', `select register_file_version($1,$2,'발표자료.pptx','p1','application/pptx',1000,'text',1200,0,'{}')`, [teamA, s2]);
const fv = (await as('service', `select register_file_version($1,$2,'발표자료.pptx','p2','application/pptx',1000,'text2',300,100,'{"slides_changed":[3,5],"slides_added":[9]}') as r`, [teamA, s3]))[0].r;
ok(fv.version === 2, 'pptx v2');
ev = await db.query(`select points from activity_events where ref_id=$1`, [fv.file_version_id]);
ok(ev.rows[0].points == 5.25, `파일 v2 점수 2 + 350/200 + 3×0.5 = 5.25 → ${ev.rows[0].points}`);
const same = (await as('service', `select register_file_version($1,$2,'발표자료.pptx','p3',null,1,'text2',0,0,'{}') as r`, [teamA, s4]))[0].r;
ev = await db.query(`select points from activity_events where ref_id=$1`, [same.file_version_id]);
ok(ev.rows[0].points == 0, `변경 없는 재업로드 0점 → ${ev.rows[0].points}`);

console.log('\n[kudos / 상호평가]');
const e2 = (await db.query(`select id from activity_events where user_id=$1 and type='file_version'`, [s2])).rows[0].id;
await as(s1, `insert into kudos (event_id) values ($1)`, [e2]);
await expectErr(as(s2, `insert into kudos (event_id) values ($1)`, [e2]), '본인 활동 kudos 불가');
await expectErr(as(s5, `insert into kudos (event_id) values ($1)`, [e2]), '타팀 kudos 불가');
await expectErr(as(s1, `insert into activity_events (team_id,user_id,category,type,ref_table,ref_id) values ($1,$2,'task','task_create','x',gen_random_uuid())`, [teamA, s1]), '활동 이벤트 직접 기록 불가');
// 모두가 무임승차자에게 후한 점수 (현실의 상호평가)
for (const rv of [s1, s2, s3, s4]) for (const re of [s1, s2, s3, s4]) if (rv !== re)
  await as(rv, `insert into peer_reviews (team_id,reviewee_id,score) values ($1,$2,5)`, [teamA, re]);
await expectErr(as(s1, `insert into peer_reviews (team_id,reviewee_id,score) values ($1,$2,5)`, [teamA, s5]), '타팀원 평가 불가');
ok((await as(s4, `select * from peer_reviews`)).length === 3, '본인이 쓴 평가만 보임 (받은 평가 안 보임)');
ok((await as(prof, `select * from peer_reviews`)).length === 12, '교수는 전체 평가 열람');

console.log('\n[구글 문서 연동]');
const DOC = 'application/vnd.google-apps.document', SLIDES = 'application/vnd.google-apps.presentation';
const saveGa = (u, perm) => as('service', `select save_google_account($1,$2,$3,'name','enc-token','drive.file') as n`, [u, `${perm}@gmail.com`, perm]);
await saveGa(s1, 'perm-s1');
await expectErr(as(s1, `select save_google_account($1,'x','p','n','t','s')`, [s1]), '학생은 save_google_account 직접 호출 불가');
await expectErr(saveGa(s3, 'perm-s1'), '다른 사람이 이미 연결한 구글 계정 불가');
const gdoc = (await as('service', `select link_external_doc($1,$2,'gfile-1','기획서',$3,'https://docs.google.com/x') as id`, [teamA, s1, DOC]))[0].id;
const gslides = (await as('service', `select link_external_doc($1,$2,'gfile-2','발표 슬라이드',$3,null) as id`, [teamA, s1, SLIDES]))[0].id;
await expectErr(as('service', `select link_external_doc($1,$2,'gfile-3','x',$3,null)`, [teamA, s5, DOC]), '타팀원은 문서 연결 불가');
await expectErr(as('service', `select link_external_doc($1,$2,'gfile-4','x','application/pdf',null)`, [teamA, s1]), '구글 문서/슬라이드/시트만 연결');
const recRev = (doc, rev, perm, added, removed = 0, text = 'x') => as('service',
  `select record_external_revision($1,$2,now(),$3,'구글이름',null,$4,$5,true,$6) as id`, [doc, rev, perm, added, removed, text]);
const rv1 = (await recRev(gdoc, 'r1', 'perm-s1', 500))[0].id;
const evOf = (rev) => db.query(`select e.user_id, e.category, e.points, e.amount from activity_events e join external_doc_credits c on c.id = e.ref_id where c.revision_id = $1 order by e.amount desc`, [rev]);
ev = await evOf(rv1);
ok(ev.rows[0]?.user_id === s1 && ev.rows[0].category === 'document' && ev.rows[0].points == 5, `연결된 팀원 수정 → 문서 기여 5점 → ${JSON.stringify(ev.rows[0])}`);
ok((await recRev(gdoc, 'r1', 'perm-s1', 500))[0].id === null, '같은 revision 중복 기록 안 됨');
const rv2 = (await recRev(gslides, 'r1', 'perm-s2', 1000, 200))[0].id;
const rv3 = (await recRev(gdoc, 'r2', 'perm-s2', 300))[0].id;
ok((await evOf(rv2)).rows.length === 0 && (await evOf(rv3)).rows.length === 0, '구글 미연결 팀원 수정은 보관만 (이벤트 없음)');
const credited = (await saveGa(s2, 'perm-s2'))[0].n;
ev = await evOf(rv2);
ok(credited === 2 && ev.rows[0]?.category === 'file' && ev.rows[0].points == 11, `나중에 연결하면 과거 이력 소급 (2건, 슬라이드는 파일 카테고리 11점) → ${credited}, ${JSON.stringify(ev.rows[0])}`);
ok((await db.query(`select last_revision_id from external_docs where id=$1`, [gdoc])).rows[0].last_revision_id === 'r2', '마지막 동기화 revision 기록');
await expectErr(as(s1, `select refresh_token_enc from google_accounts`), '토큰 컬럼은 본인도 조회 불가');
ok((await as(s1, `select google_email from google_accounts`)).length === 1, '본인 연결 정보만 조회');
await expectErr(as(s1, `select record_external_revision($1,'r9',now(),'perm-s1',null,null,99999,0,true,'x')`, [gdoc]), '학생은 revision 직접 기록 불가');
await expectErr(as(s1, `insert into external_docs (team_id,external_id,title,mime_type,linked_by) values ($1,'z','z',$2,$3)`, [teamA, DOC, s1]), '외부 문서 직접 insert 불가');
ok((await as(s5, `select * from external_docs`)).length === 0 && (await as(s5, `select * from external_doc_revisions`)).length === 0, '타팀은 구글 문서·이력 열람 불가');
ok((await as(prof, `select * from external_doc_revisions where team_id=$1`, [teamA])).length === 3, '교수는 구글 수정 이력 열람');

console.log('\n[구글 기여 배분 (Activity + 스냅샷)]');
await as('service', `select save_google_account($1,'perm-s1@gmail.com','perm-s1','name','enc-token','drive.file','sub-s1')`, [s1]);
await as('service', `select save_google_account($1,'perm-s2@gmail.com','perm-s2','name','enc-token','drive.file','sub-s2')`, [s2]);
await expectErr(as('service', `select save_google_account($1,'x@gmail.com','perm-s3','n','t','s','sub-s1')`, [s3]), '다른 사람의 Activity ID로 연결 불가');
const credits = (list) => JSON.stringify(list.map(([person, added, removed, share]) => ({
  person_id: person, permission_id: null, display_name: null, chars_added: added, chars_removed: removed,
  share, confidence: list.length > 1 ? 'shared' : 'single' })));
const rv4 = (await as('service',
  `select record_external_revision($1,'r3',now(),'perm-s1','구글이름',null,300,40,true,'y',$2::jsonb,now() - interval '2 minutes') as id`,
  [gdoc, credits([['sub-s1', 185, 25, 0.615], ['sub-s2', 115, 15, 0.385]])]))[0].id;
ev = await evOf(rv4);
ok(ev.rows.length === 2 && ev.rows[0].user_id === s1 && ev.rows[0].amount == 198 && ev.rows[1].user_id === s2 && ev.rows[1].amount == 123,
  `revision 1건을 두 팀원에게 나눠 기록 (185+25×0.5=198, 115+15×0.5=123) → ${JSON.stringify(ev.rows)}`);
ok((await db.query(`select author_id from external_doc_revisions where id=$1`, [rv4])).rows[0].author_id === s1, '대표 작성자 = 가장 큰 몫');

// 스냅샷: 기준 → 구간 기록 → 동시 동기화 방지 → 재배분
const T0 = '2026-11-07T14:00:00.000Z', T1 = '2026-11-07T14:02:00.000Z', T2 = '2026-11-07T14:04:00.000Z';
ok((await as('service', `select set_snapshot_state($1,null,'base',$2,$2) as ok`, [gdoc, T0]))[0].ok === true, '첫 스냅샷 기준 저장');
ok((await as('service', `select set_snapshot_state($1,null,'other',$2,$2) as ok`, [gdoc, T0]))[0].ok === false, '이미 기준이 있으면 덮어쓰지 않음');
const snap = (start, taken, list, final = false) => as('service',
  `select record_snapshot_segment($1,$2,$3,$3,'perm-s1','구글이름',null,100,0,'base+',$4::jsonb,$5) as id`,
  [gdoc, start, taken, list, final]);
const sv1 = (await snap(T0, T1, credits([['sub-s2', 100, 0, 1]])))[0].id;
ev = await evOf(sv1);
ok(ev.rows.length === 1 && ev.rows[0].user_id === s2, `스냅샷 구간을 Activity 편집자에게 → ${JSON.stringify(ev.rows)}`);
const d1 = (await db.query(`select snapshot_text, snapshot_at, snapshot_since from external_docs where id=$1`, [gdoc])).rows[0];
ok(d1.snapshot_text === 'base+' && d1.snapshot_at.toISOString() === T1 && d1.snapshot_since.toISOString() === T0, '스냅샷 기준이 다음 구간으로 이동, 시작 시각은 유지');
ok((await snap(T0, T2, null))[0].id === null, '다른 동기화가 먼저 기준을 옮겼으면 기록 안 함 (중복 집계 방지)');
const [originalEvent] = await as(s1, `select e.id from activity_events e
  join external_doc_credits c on c.id = e.ref_id where c.revision_id=$1`, [sv1]);
await as(s1, `insert into kudos (event_id) values ($1)`, [originalEvent.id]);
await as('service', `select set_revision_credits($1,$2::jsonb,true)`, [sv1, credits([['sub-s1', 60, 0, 0.6], ['sub-s2', 40, 0, 0.4]])]);
ev = await evOf(sv1);
const fin = (await db.query(`select attribution_final from external_doc_revisions where id=$1`, [sv1])).rows[0].attribution_final;
ok(ev.rows.length === 2 && ev.rows[0].user_id === s1 && ev.rows[0].amount == 60 && fin === true, `늦게 들어온 Activity로 재배분 → ${JSON.stringify(ev.rows)}`);
const [preservedEvent] = await as(s1, `select e.points from activity_events e
  join kudos k on k.event_id = e.id where e.id=$1 and k.giver_id=$2`, [originalEvent.id, s1]);
ok(Number(preservedEvent?.points) === 0.4, '재배분 후 같은 편집자의 이벤트와 인정 유지');
const sv2 = (await snap(T1, T2, null, true))[0].id;
ev = await evOf(sv2);
const c2 = (await db.query(`select confidence from external_doc_credits where revision_id=$1`, [sv2])).rows;
ok(ev.rows.length === 1 && ev.rows[0].user_id === s1 && c2[0].confidence === 'fallback', 'Activity 없으면 파일 lastModifyingUser에게 (fallback)');
const sv3 = (await as('service',
  `select record_snapshot_segment($1,$2,'2026-11-07T14:06:00Z','2026-11-07T14:06:00Z',null,null,null,50,0,'base++',$3::jsonb,true) as id`,
  [gdoc, T2, credits([['sub-s3', 50, 0, 1]])]))[0].id;
ok((await evOf(sv3)).rows.length === 0, '아직 연결 안 된 Activity 편집자 몫은 보관');
const n3 = (await as('service', `select save_google_account($1,'perm-s3@gmail.com','perm-s3','name','enc-token','drive.file','sub-s3') as n`, [s3]))[0].n;
ev = await evOf(sv3);
ok(n3 >= 1 && ev.rows[0]?.user_id === s3, `연결하면 Activity ID로 소급 → ${n3}`);
const cappedRevision = (await as('service',
  `select record_external_revision($1,'capped',now(),null,null,null,8000,0,true,'cap',$2::jsonb) as id`,
  [gdoc, credits([['sub-s1', 4000, 0, 0.5], ['sub-s2', 4000, 0, 0.5]])]))[0].id;
ev = await evOf(cappedRevision);
ok(ev.rows.length === 2 && ev.rows.every((r) => Number(r.points) === 15), 'revision 전체 상한 30점을 편집자에게 나눔');

// 언제 · 어디: 편집 시간대 + 바뀐 조각
await as('service', `select set_revision_credits($1,$2::jsonb,true)`, [sv1, JSON.stringify([{ person_id: 'sub-s1', chars_added: 100, chars_removed: 0, share: 1, confidence: 'single', edited_from: '2026-11-07T14:00:10Z', edited_to: '2026-11-07T14:01:30Z' }])]);
const win = (await db.query(`select edited_from, edited_to from external_doc_credits where revision_id=$1`, [sv1])).rows[0];
ok(win.edited_from.toISOString() === '2026-11-07T14:00:10.000Z' && win.edited_to.toISOString() === '2026-11-07T14:01:30.000Z', '편집자별 편집 시간대 저장');
await as('service', `select set_revision_changes($1,$2::jsonb,3)`, [sv1, JSON.stringify([{ op: 'insert', line: 2, added: '3조 원으로', before: '시장 규모는 ', after: ' 크다.' }])]);
const ch = (await as(s2, `select changes, changes_truncated from external_doc_revisions where id=$1`, [sv1]))[0];
ok(ch.changes[0].line === 2 && ch.changes[0].added === '3조 원으로' && ch.changes_truncated === 3, '바뀐 조각 저장 · 팀원 열람');
await expectErr(as(s1, `select set_revision_changes($1,'[]'::jsonb,0)`, [sv1]), '학생은 바뀐 조각 직접 변경 불가');
await expectErr(as(s1, `select set_revision_credits($1,'[]'::jsonb,true)`, [sv1]), '학생은 배분 직접 변경 불가');
ok((await as(s5, `select * from external_doc_credits`)).length === 0, '타팀은 배분 열람 불가');
ok((await as(s1, `select * from external_doc_credits where team_id=$1`, [teamA])).length > 0, '팀원은 배분 열람');

console.log('\n[구글 문서 제안 자동 기록]');
await db.query(`update google_accounts set display_name = case user_id when $1 then '민성' when $2 then '왕유' else '동명이인' end`, [s1, s2]);
const recSug = (id, name, added, removed = 0) => as('service',
  `select record_external_suggestion($1,$2,$3,'',$4,$5,$6,'2026-11-07T07:32:24Z') as id`, [gdoc, id, 'x'.repeat(added), added, removed, name]);
const sg1 = (await recSug('suggest.a', '민성', 40, 10))[0].id;
ev = await db.query(`select user_id, amount, meta->>'confidence' as c from activity_events where ref_table='external_doc_suggestions' and ref_id=$1`, [sg1]);
ok(ev.rows[0]?.user_id === s1 && ev.rows[0].amount == 45 && ev.rows[0].c === 'exact', `제안 작성자(docx 이름)에게 정확히 기여 (40+10×0.5) → ${JSON.stringify(ev.rows[0])}`);
ok((await recSug('suggest.a', '민성', 40, 10))[0].id === null, '같은 제안 중복 기록 안 됨');
const sg2 = (await recSug('suggest.b', '외부인', 20))[0].id;
ok((await db.query(`select 1 from activity_events where ref_id=$1`, [sg2])).rows.length === 0, '팀원 이름과 안 맞으면 보관만');
await db.query(`update google_accounts set display_name='민성' where user_id=$1`, [s3]);
const sg3 = (await recSug('suggest.c', '민성', 20))[0].id;
ok((await db.query(`select author_id from external_doc_suggestions where id=$1`, [sg3])).rows[0].author_id === null, '팀 안에 같은 이름이 둘이면 귀속 안 함');
await db.query(`update google_accounts set display_name='외부인' where user_id=$1`, [s3]);
const n4 = (await as('service', `select credit_pending_suggestions($1) as n`, [s3]))[0].n;
ok(n4 === 1 && (await db.query(`select user_id from activity_events where ref_id=$1`, [sg2])).rows[0]?.user_id === s3, `이름이 맞는 팀원이 생기면 소급 → ${n4}`);
await expectErr(as(s1, `select record_external_suggestion($1,'z','a','',1,0,'민성',null)`, [gdoc]), '학생은 제안 기록 직접 호출 불가');
ok((await as(s2, `select * from external_doc_suggestions where team_id=$1`, [teamA])).length === 3, '팀원은 제안 기록 열람');
ok((await as(s5, `select * from external_doc_suggestions`)).length === 0, '타팀은 제안 기록 열람 불가');
const gs = await as(s3, `select name, connected from get_team_google_status($1)`, [teamA]);
ok(gs.length === 4 && gs.filter(g => g.connected).length === 3, '팀원별 구글 연결 상태');

console.log('\n[기여도]');
const contrib = await as(prof, `select name, share_pct, peer_share_pct, mismatch, event_count, kudos_received from get_team_contributions($1)`, [teamA]);
console.table(contrib);
const sum = contrib.reduce((a, c) => a + Number(c.share_pct), 0);
ok(Math.abs(sum - 100) < 0.5, `share 합 ≈ 100 → ${sum}`);
const fr = contrib.find(c => c.name === '무임승차');
ok(fr.mismatch === true && Number(fr.share_pct) < 10, '무임승차자 불일치 플래그');
ok((await as(s5, `select * from get_team_contributions($1)`, [teamA])).length === 0, '타팀은 기여도 조회 불가');
ok((await as(s5, `select * from tasks where team_id=$1`, [teamA])).length === 0, '타팀 태스크 열람 불가');
ok((await as(prof, `select * from activity_events where team_id=$1`, [teamA])).length > 0, '교수는 팀 활동 열람');
ok((await as(s5, `select * from profiles`)).length === 6, '같은 과목 프로필만 열람');


console.log('\n[투트랙: 독립 팀플 / 과목 팀플]');
const indie = (await as(s1, `select create_independent_team('스터디 팀플') as r`))[0].r;
const indieCourse = (await db.query(`select c.kind, c.professor_id, t.invite_code from teams t join courses c on c.id = t.course_id where t.id=$1`, [indie.team_id])).rows[0];
ok(indieCourse.kind === 'independent' && indieCourse.professor_id === null && indieCourse.invite_code === indie.invite_code && indie.invite_code.length === 6,
  `학생이 과목 코드 없이 독립 팀 생성 + 팀 초대코드 발급 → ${indie.invite_code}`);
await expectErr(as(prof, `select create_independent_team('교수 팀')`), '교수는 독립 팀 생성 불가');
await expectErr(as(s1, `select create_independent_team('   ')`), '빈 팀 이름 불가');
ok((await as(s5, `select join_team_by_code($1) as id`, [indie.invite_code.toLowerCase()]))[0].id === indie.team_id, '팀 초대코드로 합류 (대소문자 무관)');
await expectErr(as(s5, `select join_team_by_code($1)`, [indie.invite_code]), '같은 팀 중복 합류 불가');
await expectErr(as(s2, `select join_team_by_code('ZZZZZZ')`), '잘못된 팀 초대코드');
await expectErr(as(prof, `select join_team_by_code($1)`, [indie.invite_code]), '교수는 팀 초대코드로 합류 불가');
ok((await as(s5, `select * from team_members where team_id=$1`, [indie.team_id])).length === 2, '독립 팀원끼리 팀원 목록 열람');
ok((await as(s5, `select name from profiles where id=$1`, [s1])).length === 1, '독립 팀원끼리 프로필 열람');
ok((await as(prof, `select * from teams where id=$1`, [indie.team_id])).length === 0
  && (await as(prof, `select * from get_team_contributions($1)`, [indie.team_id])).length === 0, '교수는 독립 팀을 볼 수 없음');
ok((await as(s3, `select * from teams where id=$1`, [indie.team_id])).length === 0, '다른 학생은 독립 팀을 볼 수 없음');
const indieCourseId = (await db.query(`select course_id from teams where id=$1`, [indie.team_id])).rows[0].course_id;
const indieCourseCode = (await db.query(`select invite_code from courses where id=$1`, [indieCourseId])).rows[0].invite_code;
await expectErr(as(s3, `select join_course($1)`, [indieCourseCode]), '과목 코드로 독립 팀플 과목에 들어갈 수 없음');
await expectErr(as(s1, `select create_team($1,'둘째 팀')`, [indieCourseId]), '독립 팀플에는 팀 추가 불가');
await as(s1, `insert into tasks (team_id, title, status, assignee_id) values ($1,'자료조사','done',$2)`, [indie.team_id, s1]);
const indieScore = await as(s5, `select name, share_pct from get_team_contributions($1)`, [indie.team_id]);
ok(indieScore.length === 2 && indieScore.some(r => Number(r.share_pct) === 100), `독립 팀도 기본 가중치로 기여 점수 계산 → ${JSON.stringify(indieScore)}`);
ok((await as(s5, `select team_id from team_members where user_id=$1`, [s5])).length === 2, '한 학생이 과목 팀 + 독립 팀에 동시 소속');
await expectErr(db.query(`insert into courses (kind, professor_id, name, semester) values ('class', null, 'x', '2026-2')`), '수업 과목은 교수 필수');
console.log('\n[회원가입: 학생 / 교수 선택]');
{
  const stu = await mk('새학생');
  ok((await as(stu, `select public.complete_signup('student', '2026012345', '컴퓨터소프트웨어학부') r`))[0].r === 'student', '학생으로 가입 → student');
  const row = (await db.query(`select role, student_no, department from profiles where id=$1`, [stu])).rows[0];
  ok(row.role === 'student' && row.student_no === '2026012345' && row.department === '컴퓨터소프트웨어학부', '학번 · 학과 저장');

  const want = await mk('새교수');
  ok((await as(want, `select public.complete_signup('professor', null, '정보시스템학과') r`))[0].r === 'pending', '허용 목록 밖에서 교수 선택 → 신청(pending)');
  ok((await db.query(`select role from profiles where id=$1`, [want])).rows[0].role === 'student', '신청만으로는 교수 권한 없음 (학생 권한)');
  ok((await as(want, `select status from professor_requests`)).length === 1, '본인 신청 상태는 볼 수 있음');
  ok((await as(stu, `select status from professor_requests`)).length === 0, '다른 사람 신청은 안 보임');
  await expectErr(as(want, `update professor_requests set status='approved'`), '신청을 스스로 승인할 수 없음');
  await expectErr(as(want, `update profiles set role='professor' where id=$1`, [want]), '역할 컬럼 직접 변경 불가');

  await db.query(`insert into professor_emails (email) values ('새교수@hanyang.ac.kr')`);
  ok((await db.query(`select role from profiles where id=$1`, [want])).rows[0].role === 'professor', '관리자가 허용 목록에 추가 → 교수로 승격');
  ok((await db.query(`select status from professor_requests where user_id=$1`, [want])).rows[0].status === 'approved', '신청은 approved로 처리');
  ok((await as(want, `select public.complete_signup('professor') r`))[0].r === 'professor', '승격 뒤 다시 호출하면 professor');

  ok((await as(prof, `select public.complete_signup('professor') r`))[0].r === 'professor', '허용 목록 교수는 바로 professor');
  await expectErr(as(stu, `select public.complete_signup('admin')`), '없는 역할 거부');
  await db.exec('set role anon');
  await expectErr(db.query(`select public.complete_signup('student')`), '로그인 없이 호출 불가');
  await db.exec('reset role');
}
console.log('\n[알림: 수신자·권한·예약·이동]');
{
  // Given a task owned by another member of the same team.
  const task = (await as(s1, `insert into tasks(team_id,title,assignee_id) values($1,'알림 검증',$2) returning id`, [teamA, s2]))[0].id;
  // When its assignee starts work.
  await as(s2, `update tasks set status='doing' where id=$1`, [task]);
  // Then every other member gets one persistent notification, without notifying the actor.
  const notices = (await db.query(`select recipient_id from notifications where entity_id=$1 and kind='task_status'`, [task])).rows;
  ok(notices.length === 4 && !notices.some(n => n.recipient_id === s2), '상태 변경은 본인을 제외한 팀원·담당 교수에게 한 번씩 알림');
  await as(s2, `update tasks set status='doing' where id=$1`, [task]);
  ok((await db.query(`select id from notifications where entity_id=$1 and kind='task_status'`, [task])).rows.length === 4, '같은 상태 저장은 중복 알림 없음');
  ok((await as(s5, `select * from notifications where entity_id=$1`, [task])).length === 0, '다른 팀은 알림을 볼 수 없음');
  const mine = (await as(s1, `select * from notifications where entity_id=$1 and kind='task_status'`, [task]))[0];
  ok(mine?.recipient_id === s1, '받은 사람만 자신의 알림 열람');
  const professorNotice = (await as(prof, `select href from notifications where entity_id=$1 and kind='task_status'`, [task]))[0];
  ok(professorNotice?.href === `/professor/teams/${teamA}/dashboard`, '담당 교수 알림은 해당 팀의 교수 조회 화면으로 연결');
  ok((await as(prof, `select id from notifications where team_id=$1`, [indie.team_id])).length === 0, '교수는 독립 팀 알림을 받거나 열람할 수 없음');
  ok((await as(s2, `update notifications set read_at=now() where id=$1 returning id`, [mine.id])).length === 0, '다른 사람의 알림을 읽음 처리할 수 없음');
  await as(s1, `update notifications set read_at=now() where id=$1`, [mine.id]);
  ok((await as(s1, `select read_at from notifications where id=$1`, [mine.id]))[0].read_at !== null, '읽음 상태 영속 저장');
  await expectErr(as(s1, `update notifications set title='조작' where id=$1`, [mine.id]), '알림 내용 수정 금지');
  await expectErr(as(s1, `select notify_team($1,$2,$3,'fake','x','x','/lamp/board')`, [teamA, s1, task]), '클라이언트가 임의 알림을 보낼 수 없음');
  await as(s1, `update tasks set assignee_id=$2 where id=$1`, [task, s3]);
  const assignment = (await db.query(`select recipient_id from notifications where entity_id=$1 and kind='task_assigned'`, [task])).rows;
  ok(assignment.length === 1 && assignment[0].recipient_id === s3, '담당자 지정은 새 담당자에게 알림');
  await as(s1, `update tasks set title='바뀐 제목',description='수정한 설명',due_date=(now() at time zone 'Asia/Seoul')::date+3 where id=$1`, [task]);
  ok((await as(s2, `select kind from notifications where entity_id=$1 and kind='task_edited'`, [task])).length === 1, '제목·설명·마감 수정은 하나의 알림');
  const dueReminders = (await db.query(`select recipient_id from notifications where entity_id=$1 and kind in ('task_due_day','task_due_today')`, [task])).rows;
  ok(dueReminders.length === 2 && dueReminders.every(n => n.recipient_id === s3), '마감 알림은 담당자에게만 예약');
  await as(s3, `update tasks set status='done' where id=$1`, [task]);
  ok((await db.query(`select id from notifications where entity_id=$1 and kind in ('task_due_day','task_due_today')`, [task])).rows.length === 0, '할 일을 완료하면 마감 알림 제거');

  // Given a meeting farther away than either reminder threshold.
  const future = (await as(s1, `insert into meetings(team_id,title,held_at) values($1,'미래 회의',now()+interval '3 days') returning id`, [teamA]))[0].id;
  // When reminders are queued during creation.
  const queued = (await db.query(`select * from notifications where entity_id=$1 and kind in ('meeting_day','meeting_hour')`, [future])).rows;
  // Then both reminders exist per participant, but cannot be seen early.
  ok(queued.length === 10, '팀원·담당 교수별 하루 전·한 시간 전 알림 예약');
  ok((await as(s1, `select * from notifications where entity_id=$1 and kind in ('meeting_day','meeting_hour')`, [future])).length === 0, '예약 시간 전에는 알림을 노출하지 않음');
  await as(s1, `update meetings set held_at=now()+interval '30 minutes',location='회의실' where id=$1`, [future]);
  const imminent = await as(s2, `select kind, body from notifications where entity_id=$1 and kind in ('meeting_day','meeting_hour')`, [future]);
  ok(imminent.length === 1 && imminent[0].kind === 'meeting_hour' && imminent[0].body.includes('회의실'), '일정 변경 시 오래된 예약을 없애고 한 시간 전 알림을 노출');
  await as(s1, `delete from meetings where id=$1`, [future]);
  ok((await db.query(`select id from notifications where entity_id=$1 and kind in ('meeting_day','meeting_hour')`, [future])).rows.length === 0, '회의 삭제 시 예약 알림 제거');
  ok((await as(s2, `select kind from notifications where entity_id=$1 and kind='meeting_cancelled'`, [future])).length === 1, '회의 취소도 팀원에게 알림');

  // Given legacy tasks sharing the same position.
  const a = (await as(s1, `insert into tasks(team_id,title,position) values($1,'A',0) returning id`, [teamA]))[0].id;
  const b = (await as(s1, `insert into tasks(team_id,title,position) values($1,'B',0) returning id`, [teamA]))[0].id;
  // When B moves before A in the same column.
  await as(s1, `select move_task($1,'todo',$2)`, [b, a]);
  // Then ordering is deterministic even after a full reload.
  const ordered = await as(s1, `select id,position from tasks where team_id=$1 and status='todo' order by position`, [teamA]);
  ok(ordered.findIndex(t => t.id === b) < ordered.findIndex(t => t.id === a), '동일 위치를 가진 기존 할 일도 드래그 순서가 저장됨');
  ok(new Set(ordered.map(t => t.position)).size === ordered.length, '이동 후 컬럼 내 위치 중복 없음');
  await as(s1, `select move_task($1,'done',null)`, [b]);
  ok((await as(s1, `select status,completed_by from tasks where id=$1`, [b]))[0].status === 'done', '컬럼 이동 시 완료 규칙도 적용');
  await expectErr(as(s5, `select move_task($1,'todo',null)`, [b]), '다른 팀의 할 일 이동 금지');
  await expectErr(as(prof, `select move_task($1,'todo',null)`, [b]), '교수는 학생 할 일 이동 불가');
  await expectErr(as(s1, `select move_task($1,'doing',$2)`, [a, b]), '다른 컬럼 위치로 잘못된 이동 시 거부');
  ok((await as(s1, `select status from tasks where id=$1`, [a]))[0].status === 'todo', '잘못된 이동은 기존 상태를 보존');

  // Given a meeting scheduled before a new participant joins.
  const inviteTeam = (await as(s1, `select create_independent_team('예약 알림 팀') as r`))[0].r;
  const joinedMeeting = (await as(s1, `insert into meetings(team_id,title,held_at) values($1,'합류 뒤 회의',now()+interval '2 days') returning id`, [inviteTeam.team_id]))[0].id;
  // When a second member joins later.
  await as(s2, `select join_team_by_code($1)`, [inviteTeam.invite_code]);
  // Then the new member gets both future reminders with student destinations.
  const joinedReminders = (await db.query(`select href from notifications where recipient_id=$1 and entity_id=$2`, [s2, joinedMeeting])).rows;
  ok(joinedReminders.length === 2 && joinedReminders.every(n => n.href.startsWith('/lamp/meetings')), '나중에 합류한 팀원도 예정 회의 알림을 받음');
  ok((await db.query(`select id from notifications where team_id=$1 and recipient_id=$2`, [inviteTeam.team_id, prof])).rows.length === 0, '독립 팀에는 교수 알림 자체를 생성하지 않음');

  // Given the actual Google ingestion flow, which attributes the author after insert.
  const editDoc = (await as('service', `select link_external_doc($1,$2,'notify-edit','알림 문서',$3,null) as id`, [teamA, s1, DOC]))[0].id;
  await recRev(editDoc, 'notify-r1', 'perm-s1', 20);
  const edits = await as(s2, `select actor_id from notifications where entity_id=$1 and kind='document_edited'`, [editDoc]);
  ok(edits.length === 1 && edits[0].actor_id === s1, '구글 revision 작성자가 UPDATE로 귀속된 뒤에도 수정 알림 생성');
  await recRev(editDoc, 'notify-r2', 'perm-s1', 30);
  ok((await as(s2, `select id from notifications where entity_id=$1 and kind='document_edited'`, [editDoc])).length === 1, '같은 문서·작성자 연속 수정은 30분 동안 하나의 알림');
  await db.query(`update notifications set created_at=now()-interval '40 minutes' where entity_id=$1 and kind='document_edited'`, [editDoc]);
  const existingRevision = (await db.query(`select id from external_doc_revisions where external_doc_id=$1 order by created_at limit 1`, [editDoc])).rows[0].id;
  await as('service', `select set_revision_credits($1,null,true)`, [existingRevision]);
  ok((await as(s2, `select id from notifications where entity_id=$1 and kind='document_edited'`, [editDoc])).length === 1, '작성자가 그대로인 귀속 재계산은 시간이 지나도 수정 알림을 중복 생성하지 않음');

  // Given one API generation that inserts a team cache and a cache per member.
  const beforeReports = (await as(prof, `select id from notifications where team_id=$1 and kind='report_ready'`, [teamA])).length;
  await as('service', `insert into ai_reports(team_id,user_id,scope,audience,summary,model) values
    ($1,null,'team','professor','팀 보고서','test'),($1,$2,'member','professor','개인1','test'),($1,$3,'member','professor','개인2','test')`, [teamA,s1,s2]);
  ok((await as(prof, `select id from notifications where team_id=$1 and kind='report_ready'`, [teamA])).length === beforeReports + 1, '팀·개인 보고서 캐시를 함께 저장해도 교수 알림은 한 번');

  // Given a student with existing independent-team membership and reminders.
  await as(s4, `select join_team_by_code($1)`, [inviteTeam.invite_code]);
  await as(s1, `insert into tasks(team_id,title) values($1,'승격 전 할 일')`, [inviteTeam.team_id]);
  const oldNotice = (await as(s4, `select id from notifications where team_id=$1`, [inviteTeam.team_id]))[0];
  // When the supported allowlist hook promotes that account to professor.
  await db.query(`insert into professor_emails(email) select email from profiles where id=$1`, [s4]);
  // Then old membership cannot expose student/independent notifications or accept new ones.
  ok((await as(s4, `select id from notifications where team_id=$1`, [inviteTeam.team_id])).length === 0, '학생이 교수로 승격되어도 이전 독립 팀 알림은 열람 불가');
  ok((await as(s4, `update notifications set read_at=now() where id=$1 returning id`, [oldNotice.id])).length === 0, '승격 후 독립 팀 알림 읽음 처리도 불가');
  const afterPromotion = (await as(s1, `insert into tasks(team_id,title) values($1,'승격 뒤 할 일') returning id`, [inviteTeam.team_id]))[0].id;
  ok((await db.query(`select id from notifications where recipient_id=$1 and entity_id=$2`, [s4, afterPromotion])).rows.length === 0, '이전 독립 팀의 새 알림도 교수 계정에 전송하지 않음');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
