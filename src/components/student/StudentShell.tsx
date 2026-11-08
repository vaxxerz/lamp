"use client";
// 앱 셸: AppSidebar (워크스페이스 선택 · 그룹 메뉴) + AppHeader (경로 · 빠른 검색 · 알림 · 프로필)
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  ChartColumn,
  Check,
  ChevronsUpDown,
  CornerDownLeft,
  FileText,
  FolderOpen,
  History,
  Home,
  LayoutGrid,
  Menu,
  NotebookPen,
  PanelLeftClose,
  Plus,
  Search,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { useStudent } from "./StudentProvider";
import { Avatar, LampLogo } from "./ui";
import { Dialog } from "./Dialog";
import { NewTeamDialog } from "./Onboarding";
import { NotificationPanel, useNotifications } from "./Notifications";

type NavItem = { path: string; label: string; icon: LucideIcon };
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "워크스페이스",
    items: [
      { path: "dashboard", label: "대시보드", icon: Home },
      { path: "board", label: "작업 보드", icon: SquareKanban },
      { path: "documents", label: "문서", icon: FileText },
      { path: "files", label: "파일", icon: FolderOpen },
      { path: "meetings", label: "회의록 · 출석", icon: NotebookPen },
    ],
  },
  {
    label: "기여",
    items: [
      { path: "analysis", label: "기여 분석", icon: ChartColumn },
      { path: "activities", label: "활동 기록", icon: History },
    ],
  },
];
const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
const ICON = 16;

/** 현재 주소의 메뉴 이름 (헤더 경로용) */
function pageLabel(pathname: string) {
  if (pathname === "/lamp") return null;
  if (pathname.startsWith("/lamp/teams/new")) return "새 프로젝트";
  return ALL_ITEMS.find((i) => pathname.startsWith(`/lamp/${i.path}`))?.label ?? null;
}

/**
 * 메뉴 링크 — 활성 표시만 현재 주소에 의존 (동적 경로 prerender 때는 Suspense fallback으로 표시 없이)
 * 실데이터: 맨 위 "프로젝트"(팀 타일 홈). 홈에서는 팀을 고르기 전이라 팀 메뉴를 숨긴다.
 * Mock: 예시 팀 하나라 /lamp가 곧 대시보드.
 */
function NavLinks({ close, pathname, live }: { close: () => void; pathname: string; live: boolean }) {
  const home = pathname === "/lamp";
  return (
    <>
      {live && (
        <div className="lamp-nav-group">
          <Link onClick={close} href="/lamp" aria-current={home ? "page" : undefined}>
            <LayoutGrid size={ICON} />
            <span>모든 프로젝트</span>
          </Link>
        </div>
      )}
      {!(live && home) &&
        GROUPS.map((g) => (
          <div key={g.label} className="lamp-nav-group">
            <p className="lamp-nav-label">{g.label}</p>
            {g.items.map(({ path, label, icon: Icon }) => {
              const active =
                pathname.startsWith(`/lamp/${path}`) || (!live && path === "dashboard" && pathname === "/lamp");
              return (
                <Link onClick={close} key={path} href={`/lamp/${path}`} aria-current={active ? "page" : undefined}>
                  <Icon size={ICON} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
    </>
  );
}
/** 홈에서는 사이드바를 유지하고 프로젝트 전용 경로만 숨긴다. */
function HomeFlag({ live }: { live: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".lamp-app");
    if (app) app.dataset.home = String(live && pathname === "/lamp");
  }, [pathname, live]);
  return null;
}
function ActiveNavLinks({ close, live }: { close: () => void; live: boolean }) {
  return <NavLinks close={close} pathname={usePathname()} live={live} />;
}

/** 워크스페이스(팀) 선택 — 실데이터에서는 내 모든 팀으로 전환 */
function WorkspaceSwitcher({ close }: { close: () => void }) {
  const { ws, selectTeam } = useStudent();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newTeam, setNewTeam] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = ws.mode === "live";
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
  const teams = live && ws.teams.length
    ? ws.teams
    : [{ id: ws.team.id, name: ws.team.name, courseName: ws.team.courseName, track: ws.team.track, memberCount: ws.team.members.length }];
  return (
    <div className="lamp-switcher" ref={ref}>
      <button className="lamp-switcher-button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span className="lamp-switcher-icon" aria-hidden="true">
          {ws.team.name.slice(0, 1)}
        </span>
        <span className="lamp-switcher-text">
          <strong>{ws.team.name}</strong>
          <small>{ws.team.track === "independent" ? "독립 팀플" : ws.team.courseName}</small>
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="lamp-menu" role="menu">
          <p className="lamp-menu-label">프로젝트</p>
          {teams.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === ws.team.id}
              onClick={async () => {
                setOpen(false);
                close();
                if (t.id !== ws.team.id) await selectTeam(t.id);
                router.push("/lamp/dashboard");
              }}
            >
              <span className="lamp-switcher-icon sm" aria-hidden="true">
                {t.name.slice(0, 1)}
              </span>
              <span className="lamp-menu-text">
                {t.name}
                <small>{t.track === "independent" ? "독립 팀플" : t.courseName} · {t.memberCount}명</small>
              </span>
              {t.id === ws.team.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {live && (
            <>
              <hr />
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setNewTeam(true);
                }}
              >
                <Plus size={14} aria-hidden="true" />
                <span className="lamp-menu-text">새 프로젝트 · 참여</span>
              </button>
            </>
          )}
        </div>
      )}
      {newTeam && <NewTeamDialog close={() => setNewTeam(false)} />}
    </div>
  );
}

export function Sidebar({ close }: { close: () => void }) {
  const { ws } = useStudent();
  return (
    <>
      <div className="lamp-brand">
        <Link href={ws.mode === "live" ? "/lamp" : "/lamp/dashboard"} onClick={close} aria-label="Lamp 홈">
          <LampLogo />
        </Link>
      </div>
      <WorkspaceSwitcher close={close} />
      <nav aria-label="학생 메뉴">
        <Suspense fallback={<NavLinks close={close} pathname="" live={ws.mode === "live"} />}>
          <ActiveNavLinks close={close} live={ws.mode === "live"} />
          <HomeFlag live={ws.mode === "live"} />
        </Suspense>
      </nav>
      <div className="lamp-sidebar-bottom">
        <span className={`lamp-mode ${ws.mode}`}>{ws.mode === "live" ? "실데이터" : "Mock 데모 데이터"}</span>
      </div>
    </>
  );
}

/** 빠른 검색 (⌘K) — 메뉴 · 문서 · 작업 · 프로젝트로 이동. 실제 있는 항목만 보여준다. */
function QuickSearch({ close }: { close: () => void }) {
  const { ws } = useStudent();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const items = useMemo(() => {
    const all: { id: string; group: string; label: string; hint?: string; run: () => void | Promise<void> }[] = [
      ...ALL_ITEMS.map((i) => ({ id: `p-${i.path}`, group: "페이지", label: i.label, run: () => router.push(`/lamp/${i.path}`) })),
      ...ws.documents.map((d) => ({ id: `d-${d.id}`, group: "문서", label: d.name, hint: "문서", run: () => router.push("/lamp/documents") })),
      ...ws.tasks.map((t) => ({ id: `t-${t.id}`, group: "작업", label: t.title, hint: "작업 보드", run: () => router.push("/lamp/board") })),
    ];
    const needle = q.trim().toLowerCase();
    return (needle ? all.filter((i) => i.label.toLowerCase().includes(needle)) : all).slice(0, 12);
  }, [q, ws, router]);
  const go = (i: number) => {
    const item = items[i];
    if (!item) return;
    close();
    void item.run();
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
            placeholder="페이지, 문서, 작업 검색"
            aria-label="검색어"
            aria-controls="lamp-search-list"
            aria-activedescendant={items[index] ? `lamp-search-${items[index].id}` : undefined}
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
          {items.length === 0 && <li className="lamp-search-empty">&quot;{q}&quot;와 일치하는 항목이 없어요.</li>}
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

function Crumbs() {
  const { ws } = useStudent();
  const pathname = usePathname();
  const page = pageLabel(pathname);
  return (
    <ol className="lamp-crumbs">
      {ws.mode === "live" && (
        <li className="lamp-crumb-home">
          <Link href="/lamp">프로젝트</Link>
        </li>
      )}
      <li className="lamp-crumb-team">
        <span>{ws.team.name}</span>
      </li>
      {page && (
        <li aria-current="page">
          <span>{page}</span>
        </li>
      )}
    </ol>
  );
}

function ProjectSearch() {
  const pathname = usePathname();
  const [search, setSearch] = useState(false);
  const available = pathname !== "/lamp" && !pathname.startsWith("/lamp/teams/");
  useEffect(() => {
    if (!available) return;
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [available]);
  if (!available) return null;
  return <>
    <button className="lamp-search-trigger" onClick={() => setSearch(true)} aria-label="프로젝트 검색 (⌘K)">
      <Search size={14} aria-hidden="true" /><span>검색</span><kbd>⌘K</kbd>
    </button>
    {search && <QuickSearch close={() => setSearch(false)} />}
  </>;
}

export function Header({ toggle, open, collapsed = false }: { toggle: () => void; open: boolean; collapsed?: boolean }) {
  const [panel, setPanel] = useState<"notifications" | "profile" | null>(null);
  const { ws, supabase, selectTeam } = useStudent();
  const notifications = useNotifications({ userId: ws.me.id, live: ws.mode === "live", supabase });
  const live = ws.mode === "live";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismiss(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setPanel(null);
    }
    function keys(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", keys);
    };
  }, []);
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
        <Link href="/lamp" className="lamp-header-brand" aria-label="Lamp 모든 프로젝트">
          <LampLogo />
        </Link>
        <nav aria-label="현재 위치">
          <Suspense fallback={null}>
            <Crumbs />
          </Suspense>
        </nav>
      </div>
      <div className="lamp-header-right" ref={ref}>
        <Suspense fallback={null}><ProjectSearch /></Suspense>
        <button
          className="lamp-icon-button"
          aria-label={`알림${notifications.unread ? `, 읽지 않은 알림 ${notifications.unread}개` : ""}`}
          data-tooltip="알림"
          aria-expanded={panel === "notifications"}
          onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
        >
          <Bell size={ICON} />
          {notifications.unread > 0 && <span className="lamp-notification-dot" />}
        </button>
        <button
          className="lamp-profile"
          aria-label={live ? `${ws.me.name} 계정 메뉴` : "로그인 메뉴"}
          aria-expanded={panel === "profile"}
          onClick={() => setPanel(panel === "profile" ? null : "profile")}
        >
          <Avatar name={ws.me.name} />
        </button>
        {panel && (
          <div className="lamp-popover">
            {panel === "notifications" ? (
              <NotificationPanel notifications={notifications} close={() => setPanel(null)} teamName={(id) => ws.teams.find((team) => team.id === id)?.name ?? ws.team.name} beforeOpen={async (id) => { if (id !== ws.team.id) await selectTeam(id); }} />
            ) : live ? (
              <>
                <h3>{ws.me.name}</h3>
                <p>{ws.me.email}</p>
                <small>
                  {ws.team.track === "independent" ? "독립 팀플" : ws.team.courseName} · {ws.team.name}
                </small>
                <LogoutButton className="lamp-button secondary" />
              </>
            ) : (
              <>
                <h3>로그인하지 않았어요</h3>
                <p>지금은 예시 데이터(Mock)를 보여주고 있어요.</p>
                <a
                  className="lamp-button"
                  href="/login?next=%2Flamp"
                  onClick={(e) => {
                    // 현재 주소는 클릭할 때 읽음 (usePathname은 동적 경로 prerender를 막음)
                    e.currentTarget.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
                  }}
                >
                  Lamp 계정으로 로그인
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export function StudentShell({ children }: { children: ReactNode }) {
  const { ready, noTeam } = useStudent();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const showWorkspace = ready && !noTeam;
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="lamp-app" data-home={showWorkspace ? undefined : "true"} data-sidebar-collapsed={collapsed}>
      <a className="lamp-skip" href="#lamp-main">
        본문으로 이동
      </a>
      {showWorkspace && (
        <>
          {open && <button className="lamp-overlay" aria-label="메뉴 닫기" onClick={() => setOpen(false)} />}
          <aside id="lamp-sidebar" className={`lamp-sidebar ${open ? "is-open" : ""}`}>
            <button className="lamp-icon-button lamp-close-sidebar" aria-label="사이드바 접기" onClick={() => { setOpen(false); setCollapsed(true); }}>
              <PanelLeftClose size={ICON} />
            </button>
            <Sidebar close={() => setOpen(false)} />
          </aside>
        </>
      )}
      <div className="lamp-workspace">
        {showWorkspace ? (
          <Header open={open} collapsed={collapsed} toggle={() => {
            if (window.matchMedia("(max-width: 760px)").matches) setOpen(!open);
            else setCollapsed(!collapsed);
          }} />
        ) : (
          <header className="lamp-header">
            <Link href="/lamp" className="lamp-header-brand" aria-label="Lamp 홈">
              <LampLogo />
            </Link>
            {noTeam && <LogoutButton className="lamp-button secondary" />}
          </header>
        )}
        <main id="lamp-main" className="lamp-main">
          {children}
        </main>
      </div>
    </div>
  );
}
