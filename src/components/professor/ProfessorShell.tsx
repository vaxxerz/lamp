"use client";
// 교수 앱 셸 — 학생 StudentShell과 같은 구조 · 같은 클래스.
//  사이드바: 로고 · 수업 선택(학생의 프로젝트 선택 자리) · 메뉴 그룹 · 데이터 모드
//  헤더: 경로 · 빠른 검색(⌘K) · 알림 · 프로필(로그아웃)
//  레이아웃에 한 번만 그려져서 메뉴를 옮겨도 다시 그려지거나 로딩이 뜨지 않는다.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChartColumn,
  Check,
  ChevronsUpDown,
  CornerDownLeft,
  FileText,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  NotebookPen,
  PanelLeftClose,
  Search,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import { Avatar, LampLogo } from "@/components/student/ui";
import { Dialog } from "@/components/student/Dialog";
import { useProfessor } from "./ProfessorProvider";
import { ProfessorNotifications } from "./ProfessorNotifications";

type NavItem = { path: string; label: string; icon: LucideIcon };
// 수업 화면은 팀별 지표 · 관리만. 자세한 분석 · 기록은 아래 "팀" 탭(팀 화면)에서
export const COURSE_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "수업",
    items: [
      { path: "dashboard", label: "대시보드", icon: LayoutDashboard },
      { path: "courses", label: "과목·팀 관리", icon: UsersRound },
    ],
  },
];
export const TEAM_ITEMS: NavItem[] = [
  { path: "dashboard", label: "대시보드", icon: Home },
  { path: "analysis", label: "팀원 분석", icon: ChartColumn },
  { path: "documents", label: "연결된 문서", icon: FileText },
  { path: "activities", label: "기여 기록", icon: Activity },
  { path: "meetings", label: "회의록 · 출석", icon: NotebookPen },
];
const COURSE_ITEMS = COURSE_GROUPS.flatMap((g) => g.items);
const ICON = 16;

/** 주소 → 지금 보는 곳 */
export function useProfessorLocation() {
  const { root, data } = useProfessor();
  const pathname = usePathname();
  const query = useSearchParams();
  const rest = pathname.startsWith(root)
    ? pathname.slice(root.length).split("/").filter(Boolean)
    : [];
  const teamId = rest[0] === "teams" ? (rest[1] ?? null) : null;
  const team = teamId ? data?.teams.find((t) => t.id === teamId) : undefined;
  const section = teamId ? (rest[2] ?? "dashboard") : (rest[0] ?? "home");
  const courseId = team?.courseId ?? query.get("course") ?? null;
  return { rest, teamId, team, section, courseId, home: rest.length === 0 };
}

/** 수업 선택 — 학생의 프로젝트 선택과 같은 자리 · 모양 */
function CourseSwitcher({ close }: { close: () => void }) {
  const { data, root } = useProfessor();
  const { courseId, section, teamId } = useProfessorLocation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const courses = data?.courses ?? [];
  const current = courses.find((c) => c.id === courseId);
  const teamsOf = (id: string) =>
    data?.teams.filter((t) => t.courseId === id).length ?? 0;
  // 수업을 바꿔도 보던 메뉴는 유지 (팀 화면이면 그 수업의 대시보드로)
  const target = teamId || section === "home" ? "dashboard" : section;
  return (
    <div className="lamp-switcher" ref={ref}>
      <button
        className="lamp-switcher-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <span className="lamp-switcher-icon" aria-hidden="true">
          {(current?.name ?? "전").slice(0, 1)}
        </span>
        <span className="lamp-switcher-text">
          <strong>{current?.name ?? "전체 수업"}</strong>
          <small>
            {current
              ? `${current.semester ?? "2026-2"} · 팀 ${teamsOf(current.id)}개`
              : `담당 수업 ${courses.length}개`}
          </small>
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="lamp-menu" role="menu">
          <p className="lamp-menu-label">수업</p>
          <button
            role="menuitemradio"
            aria-checked={!current}
            onClick={() => {
              setOpen(false);
              close();
              router.push(`${root}/${target}`);
            }}
          >
            <span className="lamp-switcher-icon sm" aria-hidden="true">
              전
            </span>
            <span className="lamp-menu-text">
              전체 수업
              <small>담당 수업 {courses.length}개 합계</small>
            </span>
            {!current && <Check size={14} aria-hidden="true" />}
          </button>
          {courses.map((c) => (
            <button
              key={c.id}
              role="menuitemradio"
              aria-checked={c.id === current?.id}
              onClick={() => {
                setOpen(false);
                close();
                router.push(`${root}/${target}?course=${c.id}`);
              }}
            >
              <span className="lamp-switcher-icon sm" aria-hidden="true">
                {c.name.slice(0, 1)}
              </span>
              <span className="lamp-menu-text">
                {c.name}
                <small>
                  {c.semester ?? "2026-2"} · 팀 {teamsOf(c.id)}개
                </small>
              </span>
              {c.id === current?.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLinks({ close }: { close: () => void }) {
  const { root, data } = useProfessor();
  const { teamId, team, section, courseId, home } = useProfessorLocation();
  const teams =
    data?.teams.filter((t) => !courseId || t.courseId === courseId) ?? [];
  const q = courseId ? `?course=${courseId}` : "";
  return (
    <>
      <div className="lamp-nav-group">
        <Link
          onClick={close}
          href={root}
          aria-current={home ? "page" : undefined}
        >
          <LayoutGrid size={ICON} />
          <span>모든 수업</span>
        </Link>
      </div>
      {COURSE_GROUPS.map((g) => (
        <div key={g.label} className="lamp-nav-group">
          <p className="lamp-nav-label">{g.label}</p>
          {g.items.map(({ path, label, icon: Icon }) => (
            <Link
              onClick={close}
              key={path}
              href={`${root}/${path}${q}`}
              aria-current={!teamId && section === path ? "page" : undefined}
            >
              <Icon size={ICON} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      ))}
      {/* 팀 탭 — 고른 수업의 팀 (수업을 안 골랐으면 모든 팀). 들어가야 팀원 분석 · 기록이 보인다 */}
      <div className="lamp-nav-group">
        <p className="lamp-nav-label">팀</p>
        {teams.map((t) => (
          <Link
            onClick={close}
            key={t.id}
            href={`${root}/teams/${encodeURIComponent(t.id)}/dashboard`}
            aria-current={teamId === t.id ? "true" : undefined}
            className="prof-team-tab"
          >
            <span className="prof-team-tab-icon" aria-hidden="true">
              {t.name.slice(0, 1)}
            </span>
            <span>{t.name}</span>
          </Link>
        ))}
        {!teams.length && <p className="prof-nav-empty">아직 팀이 없어요.</p>}
      </div>
      {teamId && (
        <div className="lamp-nav-group">
          <p className="lamp-nav-label">{team?.name ?? "팀"}</p>
          {TEAM_ITEMS.map(({ path, label, icon: Icon }) => (
            <Link
              onClick={close}
              key={path}
              href={`${root}/teams/${encodeURIComponent(teamId)}/${path}`}
              aria-current={section === path ? "page" : undefined}
            >
              <Icon size={ICON} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Sidebar({ close }: { close: () => void }) {
  const { root, live } = useProfessor();
  return (
    <>
      <div className="lamp-brand">
        <Link href={root} onClick={close} aria-label="Lamp 모든 수업">
          <LampLogo />
        </Link>
      </div>
      <CourseSwitcher close={close} />
      <nav aria-label="교수 메뉴">
        <NavLinks close={close} />
      </nav>
      <div className="lamp-sidebar-bottom">
        <span className={`lamp-mode ${live ? "live" : "mock"}`}>
          {live ? "실데이터" : "Mock 데모 데이터"}
        </span>
      </div>
    </>
  );
}

/** 빠른 검색 (⌘K) — 메뉴 · 수업 · 팀으로 이동 */
function QuickSearch({ close }: { close: () => void }) {
  const { data, root } = useProfessor();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const items = useMemo(() => {
    const all: { id: string; group: string; label: string; href: string }[] = [
      { id: "p-home", group: "페이지", label: "모든 수업", href: root },
      ...COURSE_ITEMS.map((i) => ({
        id: `p-${i.path}`,
        group: "페이지",
        label: i.label,
        href: `${root}/${i.path}`,
      })),
      ...(data?.courses ?? []).map((c) => ({
        id: `c-${c.id}`,
        group: "수업",
        label: c.name,
        href: `${root}/dashboard?course=${c.id}`,
      })),
      ...(data?.teams ?? []).map((t) => ({
        id: `t-${t.id}`,
        group: "팀",
        label: t.name,
        href: `${root}/teams/${encodeURIComponent(t.id)}/dashboard`,
      })),
    ];
    const needle = q.trim().toLowerCase();
    return (
      needle ? all.filter((i) => i.label.toLowerCase().includes(needle)) : all
    ).slice(0, 12);
  }, [q, data, root]);
  const go = (i: number) => {
    const item = items[i];
    if (!item) return;
    close();
    router.push(item.href);
  };
  return (
    <Dialog close={close} labelId="lamp-search-title">
      <div className="lamp-search">
        <h2 id="lamp-search-title" className="lamp-sr-only">
          빠른 검색
        </h2>
        <div className="lamp-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            value={q}
            placeholder="페이지, 수업, 팀 검색"
            aria-label="검색어"
            aria-controls="lamp-search-list"
            aria-activedescendant={
              items[index] ? `lamp-search-${items[index].id}` : undefined
            }
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(index);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul id="lamp-search-list" role="listbox" className="lamp-search-list">
          {items.length === 0 && (
            <li className="lamp-search-empty">
              &quot;{q}&quot;와 일치하는 항목이 없어요.
            </li>
          )}
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`lamp-search-${item.id}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => go(i)}
            >
              <span className="lamp-search-group">{item.group}</span>
              <span className="lamp-search-label">{item.label}</span>
              {i === index && <CornerDownLeft size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

const pageLabel = (section: string, team: boolean) =>
  (team ? TEAM_ITEMS : COURSE_ITEMS).find((i) => i.path === section)?.label ??
  null;

function Crumbs() {
  const { data, root } = useProfessor();
  const { team, teamId, section, courseId, home } = useProfessorLocation();
  const course = data?.courses.find((c) => c.id === courseId);
  const page = home ? null : pageLabel(section, !!teamId);
  return (
    <ol className="lamp-crumbs">
      <li className="lamp-crumb-home">
        <Link href={root}>모든 수업</Link>
      </li>
      {course && (
        <li className="lamp-crumb-team">
          <Link href={`${root}/dashboard?course=${course.id}`}>
            {course.name}
          </Link>
        </li>
      )}
      {team && (
        <li>
          <Link href={`${root}/teams/${encodeURIComponent(team.id)}/dashboard`}>
            {team.name}
          </Link>
        </li>
      )}
      {page && (
        <li aria-current="page">
          <span>{page}</span>
        </li>
      )}
    </ol>
  );
}

function Header({ toggle, open, collapsed = false }: { toggle: () => void; open: boolean; collapsed?: boolean }) {
  const { data, live, root } = useProfessor();
  const [panel, setPanel] = useState<"profile" | null>(null);
  const [search, setSearch] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismiss(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setPanel(null);
    }
    function keys(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", keys);
    };
  }, []);
  const name = data?.professor.name ?? "교수";
  return (
    <header className="lamp-header">
      <div className="lamp-header-left">
        <button
          className="lamp-icon-button lamp-mobile-toggle"
          aria-label="메뉴 열기 또는 닫기"
          aria-expanded={!collapsed}
          aria-controls="lamp-sidebar"
          onClick={toggle}
        >
          <Menu size={18} />
        </button>
        <button className="lamp-icon-button lamp-phone-toggle" aria-label="모바일 메뉴 열기 또는 닫기" aria-expanded={open} aria-controls="lamp-sidebar" onClick={toggle}><Menu size={18} /></button>
        <Link
          href={root}
          className="lamp-header-brand"
          aria-label="Lamp 모든 수업"
        >
          <LampLogo />
        </Link>
        <nav aria-label="현재 위치">
          <Crumbs />
        </nav>
      </div>
      <div className="lamp-header-right" ref={ref}>
        <button
          className="lamp-search-trigger"
          onClick={() => setSearch(true)}
          aria-label="빠른 검색 (⌘K)"
        >
          <Search size={14} aria-hidden="true" />
          <span>검색</span>
          <kbd>⌘K</kbd>
        </button>
        {data && (
          <ProfessorNotifications
            userId={data.professor.id}
            live={live}
            teams={data.teams}
          />
        )}
        <button
          className="lamp-profile"
          aria-label={`${name} 계정 메뉴`}
          aria-expanded={panel === "profile"}
          onClick={() => setPanel(panel === "profile" ? null : "profile")}
        >
          <Avatar name={name} />
        </button>
        {panel && (
          <div className="lamp-popover">
            {live ? (
              <>
                <h3>{name}</h3>
                <p>교수 · 담당 수업 {data?.courses.length ?? 0}개</p>
                <small>담당 과목의 기록만 읽기 전용으로 봐요.</small>
                <LogoutButton className="lamp-button secondary" />
              </>
            ) : (
              <>
                <h3>{name} (예시)</h3>
                <p>지금은 예시 데이터(Mock)를 보여주고 있어요.</p>
                <a className="lamp-button" href="/login?next=%2Fprofessor">
                  교수 계정으로 로그인
                </a>
              </>
            )}
          </div>
        )}
      </div>
      {search && <QuickSearch close={() => setSearch(false)} />}
    </header>
  );
}

export function ProfessorShell({ children }: { children: ReactNode }) {
  const { home } = useProfessorLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    // 모든 수업(첫 화면)은 학생의 모든 프로젝트처럼 사이드바 없이 전체 폭
    <div className="lamp-app prof-shell" data-home={home ? "true" : undefined} data-sidebar-collapsed={collapsed}>
      <a className="lamp-skip" href="#lamp-main">
        본문으로 이동
      </a>
      {open && (
        <button
          className="lamp-overlay"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="lamp-sidebar"
        className={`lamp-sidebar ${open ? "is-open" : ""}`}
      >
        <button
          className="lamp-icon-button lamp-close-sidebar"
          aria-label="사이드바 접기"
          onClick={() => {
            setOpen(false);
            setCollapsed(true);
          }}
        >
          <PanelLeftClose size={ICON} />
        </button>
        <Sidebar close={() => setOpen(false)} />
      </aside>
      <div className="lamp-workspace">
        <Header
          open={open}
          collapsed={collapsed}
          toggle={() => {
            if (window.matchMedia("(max-width: 760px)").matches) setOpen(!open);
            else setCollapsed(!collapsed);
          }}
        />
        <main id="lamp-main" className="lamp-main">
          {children}
        </main>
      </div>
    </div>
  );
}
