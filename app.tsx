// Buscar Threads — substitui a lista de threads da barra lateral por uma
// lista com busca, filtros, pastas e tags. Tags ficam nos metadados de
// cada thread; server.ts expõe `room-cli tags` para os agentes.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
    experimental_useProviders,
  experimental_useSidebarThreads,
  ThreadTitle,
  useSidebarThreadRowStatus,
  useRealtime,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Filters {
  query: string;
  projectId: string; // "" = todos
  providerId: string; // "" = todos
  host: string; // "" = todas; "-" = sem máquina
  tag: string; // "" = todas
  section: string; // "" = todas; "-" = sem pasta
  archived: boolean;
  showFilters: boolean;
}

const EMPTY: Filters = {
  query: "",
  projectId: "",
  providerId: "",
  host: "",
  tag: "",
  section: "",
  archived: false,
  showFilters: true,
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

const TASK_KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const TAG_COLORS = [
  "border-sky-400/40 text-sky-300",
  "border-violet-400/40 text-violet-300",
  "border-emerald-400/40 text-emerald-300",
  "border-pink-400/40 text-pink-300",
  "border-orange-400/40 text-orange-300",
  "border-teal-400/40 text-teal-300",
];
function tagColor(tag: string): string {
  if (TASK_KEY.test(tag)) return "border-amber-400/60 bg-amber-400/10 font-mono text-amber-300";
  let h = 0;
  for (const c of tag.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length]!;
}

function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 2);
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={tags.join(", ")}>
      {shown.map((t) => (
        <span key={t} className={cn("max-w-[64px] truncate rounded border px-1 text-[9px] leading-[13px]", tagColor(t))}>
          {t}
        </span>
      ))}
      {tags.length > shown.length ? (
        <span className="text-[9px] text-muted-foreground">+{tags.length - shown.length}</span>
      ) : null}
    </span>
  );
}

/** Tags de cada thread, lidas dos metadados do plugin; recarrega quando o servidor avisa. */
function useThreadTags(threadIds: readonly string[]): [Map<string, string[]>, () => void] {
  const sdk = useSdk();
  const [tags, setTags] = useState<Map<string, string[]>>(new Map());
  const [version, setVersion] = useState(0);
  useRealtime("tags-changed", () => setVersion((v) => v + 1));
  const key = useMemo(() => [...threadIds].sort().join(","), [threadIds]);
  useEffect(() => {
    const ctrl = new AbortController();
    const ids = key ? key.split(",") : [];
    (async () => {
      const next = new Map<string, string[]>();
      for (let i = 0; i < ids.length; i += 100) {
        const res = await sdk.threads.experimental_listPluginMetadata({
          threadIds: ids.slice(i, i + 100),
          signal: ctrl.signal,
        });
        for (const r of res.threads) {
          const raw = (r.metadata as { tags?: unknown } | null)?.tags;
          if (Array.isArray(raw)) {
            const list = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
            if (list.length) next.set(r.threadId, list);
          }
        }
      }
      return next;
    })()
      .then(setTags)
      .catch(() => {});
    return () => ctrl.abort();
  }, [sdk, key, version]);
  return [tags, () => setVersion((v) => v + 1)];
}

const NO_TAGS: readonly string[] = [];

const Row = memo(function Row({
  thread,
  active,
  providerLogo,
  childCount,
  tags,
  open,
  onToggle,
  onNavigate,
  onMenu,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  providerLogo: ProviderLogo;
  childCount: number;
  tags: readonly string[];
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  useMinuteTick();
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const where = isCloud(thread) ? "Nuvem" : thread.host?.name;
  const lastAt = thread.latestAttentionAt || thread.updatedAt;
  const sub = [where, thread.environment?.branchName, `última mensagem ${fullDate(lastAt)}`]
    .filter(Boolean)
    .join(" · ");
  return (
      <a
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, thread.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        }}
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
        {thread.isPinned ? <Icon name="Pin" className="size-3 shrink-0 text-muted-foreground" /> : null}
        <Tags tags={tags} />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{lastMessageLabel(lastAt)}</span>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusMark thread={thread} rowStatus={rowStatus != null} />
        </span>
      </a>
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

const DRAG_TYPE = "application/x-bb-thread-id";
const EMPTY_FOLDERS_KEY = "buscar-threads.empty-folders.v1";

type MenuState =
  | { kind: "thread"; x: number; y: number; thread: PluginSidebarThread }
  | { kind: "folder"; x: number; y: number; sectionId: string; projectId: string }
  | { kind: "project"; x: number; y: number; projectId: string };

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent",
        danger && "text-red-400",
      )}
    >
      {children}
    </button>
  );
}

function InlineInput({ placeholder, initial, onSubmit }: { placeholder: string; initial?: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial ?? "");
  return (
    <form
      className="px-1 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
    >
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded border border-border bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </form>
  );
}

function ContextMenu(props: {
  menu: MenuState;
  sections: [string, string][];
  onClose: () => void;
  onPin: (t: PluginSidebarThread) => void;
  onMove: (t: PluginSidebarThread, sectionId: string | null) => void;
  onNewFolder: (name: string, projectId: string, threadId?: string) => void;
  onRename: (t: PluginSidebarThread, title: string) => void;
  onArchive: (t: PluginSidebarThread) => void;
  tagsOf: (t: PluginSidebarThread) => readonly string[];
  onTags: (t: PluginSidebarThread, tags: string[]) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const { menu, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"" | "new" | "rename" | "move" | "tags" | "confirm-delete">("");
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const top = Math.min(menu.y, window.innerHeight - 320);
  const left = Math.min(menu.x, window.innerWidth - 240);
  const box = "fixed z-50 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg";
  const sep = <div className="my-1 h-px bg-border" />;

  let body: ReactNode;
  if (menu.kind === "thread") {
    const t = menu.thread;
    if (mode === "new") body = <InlineInput placeholder="Nome da nova pasta" onSubmit={(n) => props.onNewFolder(n, t.projectId, t.id)} />;
    else if (mode === "tags")
      body = (
        <>
          <InlineInput
            placeholder="tags separadas por vírgula"
            initial={props.tagsOf(t).join(", ")}
            onSubmit={(v) => props.onTags(t, v.split(",").map((x) => x.trim()).filter(Boolean))}
          />
          <p className="px-2 pb-1 text-[10px] text-muted-foreground">Enter salva. Apague tudo e use “Limpar tags” para tirar.</p>
          <MenuItem onClick={() => props.onTags(t, [])}>Limpar tags</MenuItem>
        </>
      );
    else if (mode === "rename") body = <InlineInput placeholder="Novo título" initial={t.displayTitle} onSubmit={(n) => props.onRename(t, n)} />;
    else if (mode === "move")
      body = (
        <div className="max-h-64 overflow-y-auto">
          {props.sections.map(([id, name]) => (
            <MenuItem key={id} onClick={() => props.onMove(t, id)}>
              <Icon name="Folder" className="size-3.5 shrink-0 text-sky-400" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {t.sectionId === id ? <span className="text-xs">✓</span> : null}
            </MenuItem>
          ))}
          {sep}
          <MenuItem onClick={() => setMode("new")}>+ Nova pasta…</MenuItem>
        </div>
      );
    else
      body = (
        <>
          <MenuItem onClick={() => props.onPin(t)}>{t.isPinned ? "Desafixar" : "Fixar no topo"}</MenuItem>
          {sep}
          <MenuItem onClick={() => setMode("move")}>Mover para pasta ›</MenuItem>
          <MenuItem onClick={() => setMode("new")}>Nova pasta com esta thread…</MenuItem>
          {t.sectionId ? <MenuItem onClick={() => props.onMove(t, null)}>Tirar da pasta</MenuItem> : null}
          {sep}
          <MenuItem onClick={() => setMode("tags")}>Tags…</MenuItem>
          <MenuItem onClick={() => setMode("rename")}>Renomear…</MenuItem>
          <MenuItem onClick={() => void navigator.clipboard?.writeText(t.id).then(onClose, onClose)}>Copiar id</MenuItem>
          {sep}
          <MenuItem onClick={() => props.onArchive(t)}>{t.isArchived ? "Desarquivar" : "Arquivar"}</MenuItem>
        </>
      );
  } else if (menu.kind === "folder") {
    const name = props.sections.find(([id]) => id === menu.sectionId)?.[1] ?? "";
    if (mode === "rename") body = <InlineInput placeholder="Nome da pasta" initial={name} onSubmit={(n) => props.onRenameFolder(menu.sectionId, n)} />;
    else if (mode === "new") body = <InlineInput placeholder="Nome da nova pasta" onSubmit={(n) => props.onNewFolder(n, menu.projectId)} />;
    else
      body = (
        <>
          <MenuItem onClick={() => setMode("rename")}>Renomear pasta…</MenuItem>
          <MenuItem onClick={() => setMode("new")}>Nova pasta…</MenuItem>
          {sep}
          {mode === "confirm-delete" ? (
            <MenuItem danger onClick={() => props.onDeleteFolder(menu.sectionId)}>
              Confirmar: apagar (as threads ficam soltas)
            </MenuItem>
          ) : (
            <MenuItem danger onClick={() => setMode("confirm-delete")}>Apagar pasta…</MenuItem>
          )}
        </>
      );
  } else {
    body = mode === "new"
      ? <InlineInput placeholder="Nome da nova pasta" onSubmit={(n) => props.onNewFolder(n, menu.projectId)} />
      : <MenuItem onClick={() => setMode("new")}>+ Nova pasta…</MenuItem>;
  }
  return (
    <div ref={ref} className={box} style={{ top, left }} onContextMenu={(e) => e.preventDefault()}>
      {body}
    </div>
  );
}

/**
 * Nomes das pastas (seções). A lista viva chega vazia nesta versão do
 * Cloudroom, então busca pela API: ao abrir, quando aparece uma pasta
 * desconhecida (um agente criou) e a cada minuto (renomeações).
 */
function useSectionNames(
  live: readonly { id: string; name: string }[],
  threads: readonly PluginSidebarThread[],
): [Map<string, string>, () => void] {
  const sdk = useSdk();
  const [fetched, setFetched] = useState<{ id: string; name: string }[]>([]);
  const [tick, setTick] = useState(0);
  const known = new Set([...live, ...fetched].map((x) => x.id));
  const unknownKey = [...new Set(threads.map((t) => t.sectionId).filter((id): id is string => !!id && !known.has(id)))]
    .sort()
    .join(",");
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    sdk.threadSections
      .list({ signal: ctrl.signal })
      .then((list) => setFetched(list.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
    return () => ctrl.abort();
  }, [sdk, unknownKey, tick]);
  const map = useMemo(() => new Map([...fetched, ...live].map((x) => [x.id, x.name])), [fetched, live]);
  return [map, () => setTick((n) => n + 1)];
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

  const [sectionName, refreshSections] = useSectionNames(state.sections, state.threads);
  const sdk = useSdk();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Pastas criadas por aqui num projeto aparecem nele mesmo vazias.
  const [emptyFolders, setEmptyFolders] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem(EMPTY_FOLDERS_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(EMPTY_FOLDERS_KEY, JSON.stringify(emptyFolders));
    } catch {
      /* ok */
    }
  }, [emptyFolders]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMenu(null);
    try {
      await fn();
    } catch (error) {
      toast.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const moveTo = (threadId: string, sectionId: string | null) =>
    act("Não deu para mover", () => sdk.threads.update({ threadId, sectionId }));
  const createFolder = (name: string, projectId: string, threadId?: string) =>
    act("Não deu para criar a pasta", async () => {
      const created = await sdk.threadSections.create({ name });
      const id = (created as { id?: string; section?: { id: string } }).id ?? (created as { section?: { id: string } }).section?.id;
      if (!id) throw new Error("resposta sem id");
      if (threadId) await sdk.threads.update({ threadId, sectionId: id });
      else setEmptyFolders((m) => ({ ...m, [projectId]: [...(m[projectId] ?? []), id] }));
      refreshSections();
    });
  const dropProps = (key: string, sectionId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setDropTarget(null);
      if (id) {
        e.preventDefault();
        void moveTo(id, sectionId);
      }
    },
  });

  const providerById = useMemo(() => {
    const m = new Map<string, (typeof providers.providers)[number]>();
    for (const p of providers.providers) m.set(p.id, p);
    return m;
  }, [providers.providers]);

  const visible = useMemo(
    () => [...state.threads, ...archived.rows].filter((t) => !t.isHidden && (f.archived || !t.isArchived)),
    [state.threads, archived.rows, f.archived],
  );

  const visibleIds = useMemo(() => visible.map((t) => t.id), [visible]);
  const visibleById = useMemo(() => new Map(visible.map((t) => [t.id, t])), [visible]);
  const [threadTags, refreshTags] = useThreadTags(visibleIds);

  // Opções dos filtros saem só do que existe de fato.
  const options = useMemo(() => {
    const prov = new Set<string>();
    const hosts = new Set<string>();
    const tagSet = new Map<string, string>();
    const secs = new Set<string>();
    const projectsWithSection = new Set<string>();
    const sectionOf = (t: PluginSidebarThread) => (t.sectionId && sectionName.has(t.sectionId) ? t.sectionId : "-");
    for (const t of visible) {
      if (!f.section || sectionOf(t) === f.section) projectsWithSection.add(t.projectId);
      prov.add(t.providerId);
      hosts.add(t.host?.name ?? "-");
      for (const tag of threadTags.get(t.id) ?? []) tagSet.set(tag.toLowerCase(), tag);
      if (!f.projectId || t.projectId === f.projectId) secs.add(sectionOf(t));
    }
    return {
      projects: state.projects
        .filter((p) => !f.section || projectsWithSection.has(p.id) || p.id === f.projectId)
        .map((p) => ({ value: p.id, label: projectName.get(p.id) ?? p.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      providers: [...prov]
        .map((id) => ({ value: id, label: providerById.get(id)?.displayName ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      hosts: [...hosts]
        .map((h) => ({ value: h, label: h === "-" ? "Nuvem" : h }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      sections: [...secs]
        .map((id) => ({ value: id, label: id === "-" ? "Sem pasta" : (sectionName.get(id) ?? id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      tags: [...tagSet.values()]
        .map((t) => ({ value: t.toLowerCase(), label: t }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [visible, state.projects, projectName, providerById, threadTags, sectionName, f.projectId, f.section]);

  const filtered = useMemo(() => {
    const words = fold(f.query.trim()).split(/\s+/).filter(Boolean);
    const out = visible.filter((t) => {
      if (f.projectId && t.projectId !== f.projectId) return false;
      if (f.providerId && t.providerId !== f.providerId) return false;
      if (f.host && (t.host?.name ?? "-") !== f.host) return false;
      if (f.section) {
        // a pasta vale para a thread e para as filhas dela
        let p: PluginSidebarThread | undefined = t;
        let sec: string | null = null;
        while (p && !sec) {
          sec = p.sectionId && sectionName.has(p.sectionId) ? p.sectionId : null;
          p = p.parentThreadId ? visibleById.get(p.parentThreadId) : undefined;
        }
        if ((sec ?? "-") !== f.section) return false;
      }
      if (f.tag && !(threadTags.get(t.id) ?? []).some((x) => x.toLowerCase() === f.tag)) return false;
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
          t.sectionId ? sectionName.get(t.sectionId) : null,
          ...(threadTags.get(t.id) ?? []),
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
  }, [visible, visibleById, f, projectName, providerById, sectionName, threadTags]);

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
  const searching = f.query !== "" || f.providerId !== "" || f.host !== "" || f.tag !== "" || f.section !== "";
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
          tags={threadTags.get(t.id) ?? NO_TAGS}
          open={open}
          onToggle={() => setOpenState((s) => ({ ...s, [t.id]: !open }))}
          onNavigate={props.onNavigate}
          onMenu={(x, y) => setMenu({ kind: "thread", x, y, thread: t })}
        />
        {open && kids.length > 0 ? (
          <div className="ml-[15px] border-l border-foreground/20 pl-1.5">
            {kids.map((k) => renderTree(k, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  // Pastas = seções do Cloudroom. Cada mãe vai para a pasta dela; as filhas
  // acompanham a mãe. Pastas por nome, threads soltas no fim.
  const renderFolders = (projectId: string, threads: PluginSidebarThread[]): ReactNode => {
    const bySection = new Map<string, PluginSidebarThread[]>();
    const loose: PluginSidebarThread[] = [];
    for (const t of threads) {
      if (t.sectionId && sectionName.has(t.sectionId)) {
        const g = bySection.get(t.sectionId);
        if (g) g.push(t);
        else bySection.set(t.sectionId, [t]);
      } else loose.push(t);
    }
    for (const id of emptyFolders[projectId] ?? []) if (sectionName.has(id) && !bySection.has(id) && !f.query) bySection.set(id, []);
    const folders = [...bySection.entries()].sort((a, b) =>
      (sectionName.get(a[0]) ?? "").localeCompare(sectionName.get(b[0]) ?? ""),
    );
    // Fixadas sempre em primeiro dentro do lugar delas (pasta ou projeto).
    const pinFirst = (list: PluginSidebarThread[]) =>
      [...list.filter((t) => t.isPinned).sort(
        (a, b) => (a.pinSortKey ?? "~").localeCompare(b.pinSortKey ?? "~") || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0),
      ), ...list.filter((t) => !t.isPinned)];
    return (
      <>
        {pinFirst(loose).filter((t) => t.isPinned).map((t) => renderTree(t, 0))}
        {folders.map(([sectionId, items]) => {
          const key = `${projectId}:${sectionId}`;
          const closed = collapsed[key] && !f.query;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: "folder", x: e.clientX, y: e.clientY, sectionId, projectId });
                }}
                {...dropProps(key, sectionId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 hover:bg-accent/60",
                  dropTarget === key && "bg-sky-400/20 ring-1 ring-sky-400/60",
                )}
              >
                <span className="-ml-1 flex size-4 shrink-0 items-center justify-center rounded border border-foreground/30 text-[11px] font-semibold leading-none text-muted-foreground">
                  {closed ? "+" : "−"}
                </span>
                <Icon name={closed ? "Folder" : "FolderOpen"} className="size-4 shrink-0 text-sky-400" />
                <span className="min-w-0 truncate font-medium">{sectionName.get(sectionId)}</span>
                <span className="flex-1" />
                <span className="shrink-0 text-[11px] text-muted-foreground">{items.length}</span>
              </button>
              {closed ? null : (
                <div className="ml-[15px] border-l border-sky-400/40 pl-1.5">{pinFirst(items).map((t) => renderTree(t, 0))}</div>
              )}
            </div>
          );
        })}
        {loose.filter((t) => !t.isPinned).map((t) => renderTree(t, 0))}
      </>
    );
  };

  const filtersOn =
    f.query !== "" || f.projectId !== "" || f.providerId !== "" || f.host !== "" || f.tag !== "" || f.section !== "" || f.archived;

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
            placeholder="Buscar título, tag, pasta, projeto, id…"
            aria-label="Buscar threads"
            autoComplete="off"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-[84px] text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {f.query ? (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => set("query", "")}
              className="absolute right-[70px] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            title="Expandir tudo"
            aria-label="Expandir tudo"
            onClick={() => {
              const all: Record<string, boolean> = {};
              for (const id of tree.children.keys()) all[id] = true;
              setOpenState(all);
              setCollapsed({});
            }}
            className="absolute right-[52px] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronsDown" className="size-3.5" />
          </button>
          <button
            type="button"
            title="Retrair tudo"
            aria-label="Retrair tudo"
            onClick={() => {
              const all: Record<string, boolean> = {};
              for (const id of tree.children.keys()) all[id] = false;
              setOpenState(all);
              const folders: Record<string, boolean> = {};
              for (const t of visible) if (t.sectionId) folders[`${t.projectId}:${t.sectionId}`] = true;
              setCollapsed(folders);
            }}
            className="absolute right-[34px] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronsUp" className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={f.showFilters ? "Esconder filtros" : "Mostrar filtros"}
            aria-expanded={f.showFilters}
            title={f.showFilters ? "Esconder filtros" : "Mostrar filtros"}
            onClick={() => set("showFilters", !f.showFilters)}
            className={cn(
              "absolute right-1 top-1/2 flex h-5 -translate-y-1/2 items-center gap-0.5 rounded px-1 text-muted-foreground hover:text-foreground",
              !f.showFilters && [f.projectId, f.providerId, f.host, f.tag, f.section].filter(Boolean).length + (f.archived ? 1 : 0) > 0 && "text-primary",
            )}
          >
            <Icon name="FilterHorizontal" className="size-3.5" />
            {!f.showFilters && [f.projectId, f.providerId, f.host, f.tag, f.section].filter(Boolean).length + (f.archived ? 1 : 0) > 0 ? <span className="text-[10px]">{[f.projectId, f.providerId, f.host, f.tag, f.section].filter(Boolean).length + (f.archived ? 1 : 0)}</span> : null}
          </button>
        </div>
        {!f.showFilters && filtersOn ? (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Filtros ativos · {filtered.length} de {visible.length}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 underline hover:text-foreground"
              onClick={() => setF((p) => ({ ...EMPTY, showFilters: p.showFilters }))}
            >
              <Icon name="X" className="size-3" /> Limpar filtros
            </button>
          </div>
        ) : null}
        {f.showFilters ? (<>
        <div className="flex gap-1">
          <Select label="Projeto" value={f.projectId} onChange={(v) => set("projectId", v)} options={options.projects} />
          <Select label="Pasta" value={f.section} onChange={(v) => set("section", v)} options={options.sections} />
          <Select label="Agente" value={f.providerId} onChange={(v) => set("providerId", v)} options={options.providers} />
        </div>
        <div className="flex gap-1">
          <Select label="Máquina" value={f.host} onChange={(v) => set("host", v)} options={options.hosts} />
          <Select label="Tag" value={f.tag} onChange={(v) => set("tag", v)} options={options.tags} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={f.archived} onChange={(e) => set("archived", e.target.checked)} />
            Incluir arquivadas
          </label>
          <span>
            {filtered.length} de {visible.length}
            {filtersOn ? (
              <button type="button" className="ml-2 underline hover:text-foreground" onClick={() => setF((p) => ({ ...EMPTY, showFilters: p.showFilters }))}>
                limpar filtros
              </button>
            ) : null}
          </span>
        </div>
        </>) : null}
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ kind: "project", x: e.clientX, y: e.clientY, projectId });
                  }}
                  {...dropProps(`p:${projectId}`, null)}
                  title="Clique direito: nova pasta. Solte uma thread aqui para tirá-la da pasta."
                  className={cn(
                    "flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground",
                    dropTarget === `p:${projectId}` && "bg-sky-400/20 ring-1 ring-sky-400/60",
                  )}
                >
                  <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3" />
                  <span className="truncate">{projectName.get(projectId) ?? projectId}</span>
                </button>
                {isCollapsed ? null : renderFolders(projectId, threads)}
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
      {menu ? (
        <ContextMenu
          menu={menu}
          sections={[...sectionName].sort((a, b) => a[1].localeCompare(b[1]))}
          onClose={() => setMenu(null)}
          onPin={(t) => act("Não deu para fixar", () => (t.isPinned ? sdk.threads.unpin({ threadId: t.id }) : sdk.threads.pin({ threadId: t.id })))}
          onMove={(t, sectionId) => moveTo(t.id, sectionId)}
          onNewFolder={(name, projectId, threadId) => createFolder(name, projectId, threadId)}
          onRename={(t, title) => act("Não deu para renomear", () => sdk.threads.update({ threadId: t.id, title }))}
          onArchive={(t) => act("Não deu para arquivar", () => (t.isArchived ? sdk.threads.unarchive({ threadId: t.id }) : sdk.threads.archive({ threadId: t.id })))}
          tagsOf={(t) => threadTags.get(t.id) ?? NO_TAGS}
          onTags={(t, tags) =>
            act("Não deu para salvar as tags", async () => {
              const seen = new Set<string>();
              const clean = tags.map((x) => x.replace(/\s+/g, " ").slice(0, 40)).filter((x) => {
                const k = x.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              });
              await sdk.threads.updatePluginMetadata(
                clean.length ? { threadId: t.id, set: { tags: clean } } : { threadId: t.id, remove: ["tags"] },
              );
              refreshTags();
            })
          }
          onRenameFolder={(id, name) => act("Não deu para renomear a pasta", async () => { await sdk.threadSections.update({ id, name }); refreshSections(); })}
          onDeleteFolder={(id) => act("Não deu para apagar a pasta", async () => { await sdk.threadSections.delete({ id }); refreshSections(); })}
        />
      ) : null}
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
