// Buscar Threads — substitui a lista de threads da barra lateral por uma
// lista com busca e filtros (projeto, agente, máquina, arquivadas).
// Só frontend: lê o estado vivo da barra lateral pelo SDK, sem servidor.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
    experimental_useProviders,
  experimental_useSidebarThreads,
  ThreadTitle,
  useSidebarThreadRowStatus,
  useSdk,
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

/** Hora da última mensagem; passou de 24 h, mostra há quanto tempo. */
function lastMessageLabel(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 24 * 3600_000)
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const d = Math.floor(diff / (24 * 3600_000));
  if (d < 30) return `há ${d} d`;
  return `há ${Math.floor(d / 30)} m`;
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Rerender a cada minuto para os horários não ficarem velhos. */
function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
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

/** Threads de nuvem não têm máquina própria; as locais têm. */
function isCloud(t: PluginSidebarThread): boolean {
  return t.host == null;
}

type ProviderLogo = React.ComponentProps<typeof ProviderIcon>["provider"];

/** Sinal à direita da linha, como o da lista nativa. */
function StatusMark({ thread, rowStatus }: { thread: PluginSidebarThread; rowStatus: boolean }) {
  const label = thread.indicatorLabel ?? undefined;
  if (thread.isArchived) return <Icon name="Archive" className="size-3.5 text-amber-400" />;
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input")
    return <span title={label} className="size-2 animate-pulse rounded-full bg-amber-400" />;
  if (thread.status === "error" || thread.queuedWork === "failed" || thread.indicator === "unread-error")
    return <span title={label ?? "Erro"} className="size-2 rounded-full bg-red-500" />;
  if (isRunning(thread) || thread.indicator === "runtime")
    return <Icon name="Spinner" className="size-3.5 animate-spin text-muted-foreground [animation-duration:2.5s]" />;
  if (thread.queuedWork === "waiting")
    return <span title={label} className="size-1.5 rounded-full bg-sky-400" />;
  if (thread.isUnread || thread.indicator === "unread-success" || rowStatus)
    return <span title={label} className="size-1.5 rounded-full bg-muted-foreground" />;
  return null;
}

const Row = memo(function Row({
  thread,
  active,
  providerLogo,
  childCount,
  open,
  onToggle,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  providerLogo: ProviderLogo;
  childCount: number;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  useMinuteTick();
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
  const where = isCloud(thread) ? "Nuvem" : thread.host?.name;
  const lastAt = thread.latestAttentionAt || thread.updatedAt;
  const sub = [where, thread.environment?.branchName, `última mensagem ${fullDate(lastAt)}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <ThreadActionsContextMenu thread={target}>
      <a
        href={thread.href}
        onClick={onNavigate}
        title={`${thread.displayTitle}\n${sub}\n${thread.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/60",
        )}
      >
        {childCount > 0 ? (
          <button
            type="button"
            aria-label={open ? "Recolher filhas" : `Mostrar ${childCount} filhas`}
            aria-expanded={open}
            title={open ? "Recolher" : `Expandir (${childCount})`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }}
            className="-ml-1 flex size-4 shrink-0 items-center justify-center rounded border border-foreground/30 text-[11px] font-semibold leading-none text-muted-foreground hover:border-foreground/60 hover:text-foreground"
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="-ml-1 size-4 shrink-0" aria-hidden />
        )}
        <Icon
          name={isCloud(thread) ? "Cloud" : "Laptop"}
          className={cn("size-4 shrink-0", isCloud(thread) ? "text-lime-400" : "text-muted-foreground")}
        />
        <ProviderIcon providerKind="agent" provider={providerLogo} className="size-4 shrink-0" aria-hidden />
        <span className={cn("min-w-0 truncate", thread.isUnread && "font-semibold")}>
          {thread.isArchived ? thread.displayTitle : <ThreadTitle threadId={thread.id} />}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{lastMessageLabel(lastAt)}</span>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusMark thread={thread} rowStatus={rowStatus != null} />
        </span>
      </a>
    </ThreadActionsContextMenu>
  );
});

type ApiThread = Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["list"]>>[number];

/**
 * A lista viva da barra lateral não traz arquivadas (o pedido de "archived"
 * volta vazio nesta versão). Busca pela API e adapta para o formato da linha.
 */
function useArchivedThreads(enabled: boolean, hostName: (id: string) => string | undefined) {
  const sdk = useSdk();
  const [rows, setRows] = useState<PluginSidebarThread[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setStatus("loading");
    (async () => {
      const all: ApiThread[] = [];
      for (let offset = 0; offset < 20_000; offset += 1000) {
        const page = await sdk.threads.list({ archived: true, limit: 1000, offset, signal: ctrl.signal });
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    })()
      .then((list) => {
        setRows(list.map((t) => fromApi(t, hostName)));
        setStatus("idle");
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus("error");
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sdk]);
  return { rows: enabled ? rows : [], status };
}

function fromApi(t: ApiThread, hostName: (id: string) => string | undefined): PluginSidebarThread {
  const hostId = t.environmentHostId;
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    titleFallback: t.titleFallback,
    displayTitle: t.title ?? t.titleFallback ?? t.id,
    parentThreadId: t.parentThreadId,
    lifecycleOwnerThreadId: null,
    sourceThreadId: t.sourceThreadId,
    sectionId: t.sectionId,
    originKind: t.originKind,
    originPluginId: t.originPluginId,
    providerId: t.providerId,
    status: t.status,
    runtimeStatus: t.status,
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: true,
    archivedAt: t.archivedAt,
    href: `/projects/${t.projectId}/threads/${t.id}`,
    isHidden: t.visibility === "hidden",
    environment: t.environmentId
      ? {
          id: t.environmentId,
          name: t.environmentName,
          branchName: t.environmentBranchName,
          path: t.environmentPath,
          isWorktree: t.environmentIsWorktree,
          providerId: t.environmentProviderId,
          workspaceDisplayKind: null,
        }
      : null,
    host: hostId ? { id: hostId, name: hostName(hostId) ?? hostId } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastReadAt: t.lastReadAt,
    latestAttentionAt: t.latestAttentionAt,
  } as unknown as PluginSidebarThread;
}

function ThreadSearchList(props: PluginThreadListProps) {
  const [f, setF] = useState<Filters>(loadFilters);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  const state = experimental_useSidebarThreads({
    experimental_lifecycles: ["active"],
  });
  const providers = experimental_useProviders();
  const hostNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of state.experimental_hosts ?? []) m.set(h.id, h.name);
    for (const t of state.threads) if (t.host) m.set(t.host.id, t.host.name);
    return m;
  }, [state.experimental_hosts, state.threads]);
  const archived = useArchivedThreads(f.archived, (id) => hostNames.get(id));

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
    () => [...state.threads, ...archived.rows].filter((t) => !t.isHidden && (f.archived || !t.isArchived)),
    [state.threads, archived.rows, f.archived],
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
        .map((h) => ({ value: h, label: h === "-" ? "Nuvem" : h }))
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

  // Árvore pai → filhas, como a lista nativa. Com filtro, os pais de quem
  // bateu entram junto para não perder o contexto.
  const byId = useMemo(() => new Map(visible.map((t) => [t.id, t])), [visible]);
  const tree = useMemo(() => {
    const ids = new Set(filtered.map((t) => t.id));
    const rows = [...filtered];
    for (const t of filtered) {
      let p = t.parentThreadId ? byId.get(t.parentThreadId) : undefined;
      while (p && !ids.has(p.id)) {
        ids.add(p.id);
        rows.push(p);
        p = p.parentThreadId ? byId.get(p.parentThreadId) : undefined;
      }
    }
    const children = new Map<string, PluginSidebarThread[]>();
    const roots: PluginSidebarThread[] = [];
    for (const t of rows) {
      if (t.parentThreadId && ids.has(t.parentThreadId)) {
        const c = children.get(t.parentThreadId);
        if (c) c.push(t);
        else children.set(t.parentThreadId, [t]);
      } else roots.push(t);
    }
    const order = (a: PluginSidebarThread, b: PluginSidebarThread) =>
      Number(isRunning(b)) - Number(isRunning(a)) ||
      Number(b.isPinned) - Number(a.isPinned) ||
      b.updatedAt - a.updatedAt;
    roots.sort(order);
    for (const c of children.values()) c.sort(order);
    return { roots, children };
  }, [filtered, byId]);

  const shown = tree.roots.slice(0, limit);
  const groups = useMemo(() => {
    const m = new Map<string, PluginSidebarThread[]>();
    for (const t of shown) {
      const g = m.get(t.projectId);
      if (g) g.push(t);
      else m.set(t.projectId, [t]);
    }
    return [...m.entries()];
  }, [shown]);

  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const searching = f.query !== "" || f.providerId !== "" || f.host !== "";
  const isOpen = (t: PluginSidebarThread, depth: number) =>
    openState[t.id] ?? (searching || depth === 0);

  const renderTree = (t: PluginSidebarThread, depth: number): ReactNode => {
    const kids = tree.children.get(t.id) ?? [];
    const open = isOpen(t, depth);
    const p = providerById.get(t.providerId);
    return (
      <div key={t.id}>
        <Row
          thread={t}
          active={t.id === props.activeThreadId}
          providerLogo={p ?? { id: t.providerId }}
          childCount={kids.length}
          open={open}
          onToggle={() => setOpenState((s) => ({ ...s, [t.id]: !open }))}
          onNavigate={props.onNavigate}
        />
        {open && kids.length > 0 ? (
          <div className="ml-[15px] border-l border-foreground/20 pl-1.5">
            {kids.map((k) => renderTree(k, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

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
                </button>
                {isCollapsed ? null : threads.map((t) => renderTree(t, 0))}
              </section>
            );
          })
        )}
        {tree.roots.length > limit ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Mostrar mais ({tree.roots.length - limit})
          </button>
        ) : null}
        {f.archived && archived.status !== "idle" ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {archived.status === "loading" ? "Carregando arquivadas…" : "Não deu para carregar as arquivadas."}
          </p>
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
