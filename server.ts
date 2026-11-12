// Backend: guarda tags por thread (metadados do plugin em cada thread) e
// expõe `room-cli tags ...` para agentes e pessoas.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const taskSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  labels: z.array(z.string()),
  agentsWorking: z.number(),
  updatedAt: z.string(),
});
export type TaskRow = z.infer<typeof taskSchema>;

const detailSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  subtasks: z.array(z.object({ key: z.string(), title: z.string(), status: z.string() })),
  comments: z.array(z.object({ body: z.string(), createdAt: z.string() })),
  threadIds: z.array(z.string()),
});
export type TaskDetail = z.infer<typeof detailSchema>;

export const rpcContract = defineRpcContract({
  task_show: {
    input: z.object({ key: z.string().regex(/^[A-Za-z0-9-]+$/) }),
    output: detailSchema,
  },
  tasks_list: {
    input: z.object({ search: z.string().optional(), includeDone: z.boolean().optional() }),
    output: z.object({ tasks: z.array(taskSchema) }),
  },
});

const ROOM_CLI_FALLBACK =
  "/Applications/Cloudroom.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/room-cli";

/** O Tasks não publica RPC; lê pelo próprio CLI do Cloudroom. */
function roomCli(args: string[]): Promise<string> {
  const bin = existsSync(ROOM_CLI_FALLBACK) ? ROOM_CLI_FALLBACK : "room-cli";
  return new Promise((resolve, reject) =>
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
    ),
  );
}

export const TAGS_CHANGED = "tags-changed";
const MAX_TAG = 40;
const CHUNK = 100;

/** Limpa e deduplica (sem diferenciar maiúscula), mantendo a primeira grafia. */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").replace(/,/g, "").slice(0, MAX_TAG);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

const HELP = `Tags de threads (plugin Buscar Threads)

Uso: room-cli tags <comando> [args] [--thread <id>]

  list                      Tags da thread (padrão: a thread atual)
  add <tag>...              Adiciona tags
  remove <tag>...           Remove tags
  set <tag>...              Troca todas as tags da thread por estas
  clear                     Remove todas as tags da thread
  all                       Todas as tags em uso, com contagem
  find <tag>                Threads com essa tag
  rename <antiga> <nova>    Renomeia uma tag em todas as threads

Tags com chave de Task (ex.: MX-213) aparecem destacadas na lista.
Use --json para saída de máquina.`;

export default function plugin(bb: BbPluginApi) {
  const threads = bb.sdk.threads;

  bb.rpc.register(rpcContract, {
    async task_show({ key }) {
      const d = JSON.parse(await roomCli(["tasks", "show", key, "--json"])) as Record<string, any>;
      const t = d.task ?? {};
      return {
        key: String(t.key ?? key),
        title: String(t.title ?? ""),
        description: String(t.description ?? ""),
        status: String(t.status ?? ""),
        priority: t.priority ?? null,
        subtasks: (d.subtasks ?? []).map((x: any) => ({ key: String(x.key), title: String(x.title ?? ""), status: String(x.status ?? "") })),
        comments: (d.comments ?? []).map((c: any) => ({ body: String(c.body ?? c.content ?? ""), createdAt: String(c.createdAt ?? "") })),
        threadIds: (d.taskThreads ?? []).map((x: any) => String(x.threadId ?? x.id)).filter(Boolean),
      };
    },
    async tasks_list({ search, includeDone }) {
      const out: TaskRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const args = ["tasks", "list", "--json", "--limit", "500", "--sort", "priority"];
        if (search) args.push("--search", search);
        if (!includeDone) for (const st of ["backlog", "todo", "in_progress", "in_review"]) args.push("--status", st);
        if (cursor) args.push("--cursor", cursor);
        const res = JSON.parse(await roomCli(args)) as { tasks: Record<string, unknown>[]; nextCursor: string | null };
        for (const t of res.tasks) {
          out.push({
            key: String(t.key),
            title: String(t.title ?? ""),
            status: String(t.status ?? ""),
            priority: (t.priority as string | null) ?? null,
            labels: Array.isArray(t.labels) ? (t.labels as string[]) : [],
            agentsWorking: Number(t.agentsWorking ?? 0),
            updatedAt: String(t.updatedAt ?? ""),
          });
        }
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return { tasks: out };
    },
  });

  const getTags = async (threadId: string) => {
    const res = await threads.experimental_listPluginMetadata({ pluginId: bb.pluginId, threadIds: [threadId] });
    return normalizeTags(res.threads.find((t) => t.threadId === threadId)?.metadata?.tags);
  };

  const putTags = async (threadId: string, tags: string[]) => {
    await threads.updatePluginMetadata(
      tags.length
        ? { pluginId: bb.pluginId, threadId, set: { tags } }
        : { pluginId: bb.pluginId, threadId, remove: ["tags"] },
    );
  };

  /** Todas as threads (ativas e arquivadas) com tags. */
  const allTagged = async () => {
    const ids: { id: string; title: string }[] = [];
    for (const archived of [false, true]) {
      for (let offset = 0; offset < 50_000; offset += 1000) {
        const page = await threads.list({ archived, limit: 1000, offset });
        for (const t of page) ids.push({ id: t.id, title: t.title ?? t.titleFallback ?? t.id });
        if (page.length < 1000) break;
      }
    }
    const titles = new Map(ids.map((x) => [x.id, x.title]));
    const out: { threadId: string; title: string; tags: string[] }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await threads.experimental_listPluginMetadata({
        pluginId: bb.pluginId,
        threadIds: ids.slice(i, i + CHUNK).map((x) => x.id),
      });
      for (const r of res.threads) {
        const tags = normalizeTags(r.metadata?.tags);
        if (tags.length) out.push({ threadId: r.threadId, title: titles.get(r.threadId) ?? r.threadId, tags });
      }
    }
    return out;
  };

  const changed = (threadIds: string[]) => bb.realtime.publish(TAGS_CHANGED, { threadIds });

  bb.cli.register({
    name: "tags",
    summary: "Tags de threads: adicionar, remover, renomear e procurar",
    rendersHelp: true,
    commands: [
      { name: "list", summary: "Tags da thread", usage: "list [--thread <id>]" },
      { name: "add", summary: "Adiciona tags", usage: "add <tag>... [--thread <id>]" },
      { name: "remove", summary: "Remove tags", usage: "remove <tag>... [--thread <id>]" },
      { name: "set", summary: "Troca as tags", usage: "set <tag>... [--thread <id>]" },
      { name: "clear", summary: "Remove todas as tags", usage: "clear [--thread <id>]" },
      { name: "all", summary: "Tags em uso", usage: "all [--json]" },
      { name: "find", summary: "Threads com uma tag", usage: "find <tag> [--json]" },
      { name: "rename", summary: "Renomeia uma tag em todas as threads", usage: "rename <antiga> <nova>" },
    ],
    async run(argv, ctx) {
      const args: string[] = [];
      let threadId = ctx.threadId;
      let json = false;
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === "--thread") threadId = argv[++i];
        else if (a.startsWith("--thread=")) threadId = a.slice(9);
        else if (a === "--json") json = true;
        else if (a === "-h" || a === "--help") return { exitCode: 0, stdout: HELP + "\n" };
        else args.push(a);
      }
      if (args[0] === "tag") args.shift();
      const [cmd, ...rest] = args;
      const fail = (msg: string) => ({ exitCode: 1, stderr: msg + "\n" });
      const print = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: (json ? JSON.stringify(value, null, 2) : text) + "\n",
      });

      try {
        switch (cmd) {
          case undefined:
          case "help":
            return { exitCode: 0, stdout: HELP + "\n" };
          case "all": {
            const counts = new Map<string, number>();
            for (const t of await allTagged()) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
            const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            return print(
              rows.map(([tag, count]) => ({ tag, count })),
              rows.length ? rows.map(([t, c]) => `${t}\t${c}`).join("\n") : "(nenhuma tag)",
            );
          }
          case "find": {
            if (!rest[0]) return fail("Uso: tags find <tag>");
            const key = rest[0].toLowerCase();
            const hits = (await allTagged()).filter((t) => t.tags.some((x) => x.toLowerCase() === key));
            return print(hits, hits.length ? hits.map((h) => `${h.threadId}\t${h.title}`).join("\n") : "(nenhuma thread)");
          }
          case "rename": {
            const [from, to] = rest;
            if (!from || !to) return fail("Uso: tags rename <antiga> <nova>");
            const key = from.toLowerCase();
            const touched: string[] = [];
            for (const t of await allTagged()) {
              if (!t.tags.some((x) => x.toLowerCase() === key)) continue;
              await putTags(t.threadId, normalizeTags(t.tags.map((x) => (x.toLowerCase() === key ? to : x))));
              touched.push(t.threadId);
            }
            if (touched.length) changed(touched);
            return print({ renamed: touched.length }, `${touched.length} thread(s) atualizada(s)`);
          }
        }

        if (!threadId) return fail("Informe --thread <id> (fora de uma thread não há thread atual).");
        const current = await getTags(threadId);
        let next: string[];
        switch (cmd) {
          case "list":
            return print({ threadId, tags: current }, current.length ? current.join("\n") : "(sem tags)");
          case "add":
            if (!rest.length) return fail("Uso: tags add <tag>...");
            next = normalizeTags([...current, ...rest]);
            break;
          case "remove": {
            if (!rest.length) return fail("Uso: tags remove <tag>...");
            const drop = new Set(rest.map((x) => x.trim().toLowerCase()));
            next = current.filter((x) => !drop.has(x.toLowerCase()));
            break;
          }
          case "set":
            next = normalizeTags(rest);
            break;
          case "clear":
            next = [];
            break;
          default:
            return fail(`Comando desconhecido: ${cmd}\n\n${HELP}`);
        }
        await putTags(threadId, next);
        changed([threadId]);
        return print({ threadId, tags: next }, next.length ? next.join(", ") : "(sem tags)");
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
