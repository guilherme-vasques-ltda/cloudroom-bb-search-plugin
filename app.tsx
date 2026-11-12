// Buscar Threads — substitui a lista de threads da barra lateral por uma
// lista com busca e filtros (projeto, agente, máquina, arquivadas).
// Só frontend: lê o estado vivo da barra lateral pelo SDK, sem servidor.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders,
  experimental_useSidebarThreads,
  ThreadTitle,
  useSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface Filters {
  query: string;
  projectId: string; // "" = todos
  providerId: string; // "" = todos
  host: string; // "" = todas; "-" = sem máquina
  archived: boolean;
}

const EMPTY: Filters = {
  query: "",
  projectId: "",
  providerId: "",
  host: "",
  archived: false,
};

const STORAGE_KEY = "buscar-threads.filters.v2";
const PAGE = 150;

const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);

function isRunning(t: PluginSidebarThread): boolean {
  return (
    BUSY.has(t.runtimeStatus) ||
    t.activity.workflows + t.activity.backgroundAgents + t.activity.backgroundCommands > 0
  );
}

/** Sem acento e minúsculo, para "seguranca" achar "segurança". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* ignora estado corrompido */
  }
  return EMPTY;
}

function relativeTime(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "min-w-0 flex-1 truncate rounded-md border bg-transparent px-1.5 py-0.5 text-xs",
        value ? "border-primary/60 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <option value="">{label}: todos</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const Row = memo(function Row({
  thread,
  active,
  providerLogo,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  providerLogo: { id: string; logoUrl?: string | null; icon?: { glyph: string } | null };
  onNavigate: () => void;
}) {
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const target = {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: thread.environment?.id
      ? { id: thread.environment.id, path: thread.environment.path }
      : null,
  };
  const sub = [thread.host?.name, thread.environment?.branchName].filter(Boolean).join(" · ");
  return (
    <ThreadActionsContextMenu thread={target}>
      <a
        href={thread.href}
        onClick={onNavigate}
        title={`${thread.displayTitle}${sub ? `\n${sub}` : ""}\n${thread.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/60",
        )}
      >
        <ProviderIcon
          providerKind="agent"
          provider={providerLogo}
          className="size-4 shrink-0"
          aria-hidden
        />
        <span className={cn("min-w-0 flex-1 truncate", thread.isUnread && "font-semibold")}>
          <ThreadTitle threadId={thread.id} />
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
          {relativeTime(thread.updatedAt)}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center" aria-label={thread.indicatorLabel ?? undefined}>
          <ThreadStatusGlyph
            indicator={thread.indicator}
            archived={thread.isArchived}
            rowStatus={rowStatus}
            size="compact"
          />
        </span>
      </a>
    </ThreadActionsContextMenu>
  );
});

function ThreadSearchList(props: PluginThreadListProps) {
  const [f, setF] = useState<Filters>(loadFilters);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  const state = experimental_useSidebarThreads({
    experimental_lifecycles: f.archived ? ["active", "archived"] : ["active"],
  });
  const providers = experimental_useProviders();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      /* sem armazenamento: segue sem lembrar */
    }
    setLimit(PAGE);
  }, [f]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of state.projects) m.set(p.id, p.isPersonal ? "Pessoal" : p.name);
    return m;
  }, [state.projects]);

  const providerById = useMemo(() => {
    const m = new Map<string, (typeof providers.providers)[number]>();
    for (const p of providers.providers) m.set(p.id, p);
    return m;
  }, [providers.providers]);

  const visible = useMemo(
    () => state.threads.filter((t) => !t.isHidden && (f.archived || !t.isArchived)),
    [state.threads, f.archived],
  );

  // Opções dos filtros saem só do que existe de fato.
  const options = useMemo(() => {
    const prov = new Set<string>();
    const hosts = new Set<string>();
    for (const t of visible) {
      prov.add(t.providerId);
      hosts.add(t.host?.name ?? "-");
    }
    return {
      projects: state.projects
        .map((p) => ({ value: p.id, label: projectName.get(p.id) ?? p.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      providers: [...prov]
        .map((id) => ({ value: id, label: providerById.get(id)?.displayName ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      hosts: [...hosts]
        .map((h) => ({ value: h, label: h === "-" ? "Sem máquina" : h }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [visible, state.projects, projectName, providerById]);

  const filtered = useMemo(() => {
    const words = fold(f.query.trim()).split(/\s+/).filter(Boolean);
    const out = visible.filter((t) => {
      if (f.projectId && t.projectId !== f.projectId) return false;
      if (f.providerId && t.providerId !== f.providerId) return false;
      if (f.host && (t.host?.name ?? "-") !== f.host) return false;
      if (words.length === 0) return true;
      const hay = fold(
        [
          t.displayTitle,
          t.titleFallback,
          t.id,
          projectName.get(t.projectId),
          providerById.get(t.providerId)?.displayName ?? t.providerId,
          t.host?.name,
          t.environment?.branchName,
          t.environment?.name,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return words.every((w) => hay.includes(w));
    });
    // Rodando primeiro, depois fixadas, depois mais recentes.
    out.sort(
      (a, b) =>
        Number(isRunning(b)) - Number(isRunning(a)) ||
        Number(b.isPinned) - Number(a.isPinned) ||
        b.updatedAt - a.updatedAt,
    );
    return out;
  }, [visible, f, projectName, providerById]);

  const shown = filtered.slice(0, limit);
  const groups = useMemo(() => {
    const m = new Map<string, PluginSidebarThread[]>();
    for (const t of shown) {
      const g = m.get(t.projectId);
      if (g) g.push(t);
      else m.set(t.projectId, [t]);
    }
    return [...m.entries()];
  }, [shown]);

  const filtersOn =
    f.query !== "" || f.projectId !== "" || f.providerId !== "" || f.host !== "" || f.archived;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b border-border/60 px-2 pb-2 pt-1">
        <div className="relative">
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={f.query}
            onChange={(e) => set("query", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                set("query", "");
                inputRef.current?.blur();
              }
            }}
            placeholder="Buscar título, projeto, branch, id…"
            aria-label="Buscar threads"
            autoComplete="off"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-7 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {f.query ? (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => set("query", "")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Select label="Projeto" value={f.projectId} onChange={(v) => set("projectId", v)} options={options.projects} />
          <Select label="Agente" value={f.providerId} onChange={(v) => set("providerId", v)} options={options.providers} />
          <Select label="Máquina" value={f.host} onChange={(v) => set("host", v)} options={options.hosts} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={f.archived} onChange={(e) => set("archived", e.target.checked)} />
            Incluir arquivadas
          </label>
          <span>
            {filtered.length} de {visible.length}
            {filtersOn ? (
              <button type="button" className="ml-2 underline hover:text-foreground" onClick={() => setF(EMPTY)}>
                limpar
              </button>
            ) : null}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {state.status === "loading" && visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Carregando…</p>
        ) : state.status === "error" && visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-destructive">Não deu para carregar as threads.</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Nada encontrado com esses filtros.</p>
        ) : (
          groups.map(([projectId, threads]) => {
            const isCollapsed = collapsed[projectId] && !f.query;
            return (
              <section key={projectId} className="mb-1">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [projectId]: !c[projectId] }))}
                  className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3" />
                  <span className="truncate">{projectName.get(projectId) ?? projectId}</span>
                  <span className="ml-auto">{threads.length}</span>
                </button>
                {isCollapsed
                  ? null
                  : threads.map((t) => {
                      const p = providerById.get(t.providerId);
                      return (
                        <Row
                          key={t.id}
                          thread={t}
                          active={t.id === props.activeThreadId}
                          providerLogo={p ? { id: p.id, logoUrl: p.logoUrl, icon: p.icon ?? null } : { id: t.providerId }}
                          onNavigate={props.onNavigate}
                        />
                      );
                    })}
              </section>
            );
          })
        )}
        {filtered.length > limit ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Mostrar mais ({filtered.length - limit})
          </button>
        ) : null}
        {f.archived && state.experimental_archived?.hasNextPage ? (
          <button
            type="button"
            disabled={state.experimental_archived.isFetchingNextPage}
            onClick={() => void state.experimental_archived?.fetchNextPage()}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {state.experimental_archived.isFetchingNextPage ? "Carregando…" : "Carregar mais arquivadas"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "buscar",
    title: "Lista com busca e filtros",
    description: "Busca por texto e filtros de projeto, agente e máquina.",
    component: ThreadSearchList,
  });
});
