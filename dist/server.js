import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);

// server.ts
var TAGS_CHANGED = "tags-changed";
var MAX_TAG = 40;
var CHUNK = 100;
function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
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
var HELP = `Tags de threads (plugin Buscar Threads)

Uso: room-cli tags <comando> [args] [--thread <id>]

  list                      Tags da thread (padr\xE3o: a thread atual)
  add <tag>...              Adiciona tags
  remove <tag>...           Remove tags
  set <tag>...              Troca todas as tags da thread por estas
  clear                     Remove todas as tags da thread
  all                       Todas as tags em uso, com contagem
  find <tag>                Threads com essa tag
  rename <antiga> <nova>    Renomeia uma tag em todas as threads

Tags com chave de Task (ex.: MX-213) aparecem destacadas na lista.
Use --json para sa\xEDda de m\xE1quina.`;
function plugin(bb) {
  const threads = bb.sdk.threads;
  const getTags = async (threadId) => {
    const res = await threads.experimental_listPluginMetadata({ pluginId: bb.pluginId, threadIds: [threadId] });
    return normalizeTags(res.threads.find((t) => t.threadId === threadId)?.metadata?.tags);
  };
  const putTags = async (threadId, tags) => {
    await threads.updatePluginMetadata(
      tags.length ? { pluginId: bb.pluginId, threadId, set: { tags } } : { pluginId: bb.pluginId, threadId, remove: ["tags"] }
    );
  };
  const allTagged = async () => {
    const ids = [];
    for (const archived of [false, true]) {
      for (let offset = 0; offset < 5e4; offset += 1e3) {
        const page = await threads.list({ archived, limit: 1e3, offset });
        for (const t of page) ids.push({ id: t.id, title: t.title ?? t.titleFallback ?? t.id });
        if (page.length < 1e3) break;
      }
    }
    const titles = new Map(ids.map((x) => [x.id, x.title]));
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await threads.experimental_listPluginMetadata({
        pluginId: bb.pluginId,
        threadIds: ids.slice(i, i + CHUNK).map((x) => x.id)
      });
      for (const r of res.threads) {
        const tags = normalizeTags(r.metadata?.tags);
        if (tags.length) out.push({ threadId: r.threadId, title: titles.get(r.threadId) ?? r.threadId, tags });
      }
    }
    return out;
  };
  const changed = (threadIds) => bb.realtime.publish(TAGS_CHANGED, { threadIds });
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
      { name: "rename", summary: "Renomeia uma tag em todas as threads", usage: "rename <antiga> <nova>" }
    ],
    async run(argv, ctx) {
      const args = [];
      let threadId = ctx.threadId;
      let json = false;
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--thread") threadId = argv[++i];
        else if (a.startsWith("--thread=")) threadId = a.slice(9);
        else if (a === "--json") json = true;
        else if (a === "-h" || a === "--help") return { exitCode: 0, stdout: HELP + "\n" };
        else args.push(a);
      }
      if (args[0] === "tag") args.shift();
      const [cmd, ...rest] = args;
      const fail = (msg) => ({ exitCode: 1, stderr: msg + "\n" });
      const print = (value, text) => ({
        exitCode: 0,
        stdout: (json ? JSON.stringify(value, null, 2) : text) + "\n"
      });
      try {
        switch (cmd) {
          case void 0:
          case "help":
            return { exitCode: 0, stdout: HELP + "\n" };
          case "all": {
            const counts = /* @__PURE__ */ new Map();
            for (const t of await allTagged()) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
            const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            return print(
              rows.map(([tag, count]) => ({ tag, count })),
              rows.length ? rows.map(([t, c]) => `${t}	${c}`).join("\n") : "(nenhuma tag)"
            );
          }
          case "find": {
            if (!rest[0]) return fail("Uso: tags find <tag>");
            const key = rest[0].toLowerCase();
            const hits = (await allTagged()).filter((t) => t.tags.some((x) => x.toLowerCase() === key));
            return print(hits, hits.length ? hits.map((h) => `${h.threadId}	${h.title}`).join("\n") : "(nenhuma thread)");
          }
          case "rename": {
            const [from, to] = rest;
            if (!from || !to) return fail("Uso: tags rename <antiga> <nova>");
            const key = from.toLowerCase();
            const touched = [];
            for (const t of await allTagged()) {
              if (!t.tags.some((x) => x.toLowerCase() === key)) continue;
              await putTags(t.threadId, normalizeTags(t.tags.map((x) => x.toLowerCase() === key ? to : x)));
              touched.push(t.threadId);
            }
            if (touched.length) changed(touched);
            return print({ renamed: touched.length }, `${touched.length} thread(s) atualizada(s)`);
          }
        }
        if (!threadId) return fail("Informe --thread <id> (fora de uma thread n\xE3o h\xE1 thread atual).");
        const current = await getTags(threadId);
        let next;
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
            return fail(`Comando desconhecido: ${cmd}

${HELP}`);
        }
        await putTags(threadId, next);
        changed([threadId]);
        return print({ threadId, tags: next }, next.length ? next.join(", ") : "(sem tags)");
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  });
}
export {
  TAGS_CHANGED,
  plugin as default,
  normalizeTags
};
//# sourceMappingURL=server.js.map
