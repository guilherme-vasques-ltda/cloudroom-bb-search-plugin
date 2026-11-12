# cloudroom-bb-search-plugin

A Cloudroom plugin that replaces the sidebar thread list with one that has **search, filters, folders and tags**, while keeping the agent tree (parent → children).

<img src="docs/screenshot.png" alt="Sidebar with search, filters and the thread tree" width="458">

<sub>Screenshot with sample data. The UI is in Portuguese (pt-BR).</sub>

## Features

### Search and filters
- Search by title, tag, folder, project, agent, machine, branch or id. Accent- and case-insensitive; with several words, all must match. `Esc` clears.
- Filters: **Project · Folder · Agent** on the first row, **Machine · Tag** on the second, plus "Include archived".
- Project and Folder narrow each other: pick a project and the Folder filter only lists its folders, and vice versa.
- **Collapsible** filters: the icon inside the search box hides/shows them and shows how many are active.
- **Clear filters** is always reachable, whether the filters are open or collapsed.
- Filters are remembered across sessions.

### Tree and list
- Grouped by project, with the same tree as the built-in list: child threads indented under their parent, with a guide line.
- **+ / −** at the start of a row opens/closes its children; **⌄ / ⌃** in the search box expand or collapse everything.
- Where the thread runs (laptop = local, cloud = cloud) and the agent's colored icon.
- Time of the last message; after 24 h, how long ago ("há 3 d").
- Status marks: spinner (running), pulsing amber (needs you), red (error), blue (queued message), gray (unread), amber box (archived).
- When filtering, the parent of a matching thread is shown too, so you keep the context.

### Folders
- Cloudroom thread sections show up as **folders inside each project**.
- **Right-click** a project name or a folder to create, rename or delete folders. Deleting asks for confirmation; its threads become loose.
- **Drag** a thread onto a folder to move it; drop it on the project name to take it out of its folder.

### Pinned
- A pinned thread is always first **inside its own place** (top of its folder, or top of the project if it is loose), with its whole tree.

### Tags
- Small tag chips before the time, up to 2 per row plus "+N".
- A tag shaped like a Task key (e.g. `MX-213`) is highlighted in amber: that is how a thread is linked to a Task.
- Edit by hand: right-click → **Tags…**, comma-separated.

### Right-click on a thread
Pin/unpin · Move to folder › · New folder with this thread · Remove from folder · Tags… · Rename… · Copy id · Archive/unarchive.

### Archived
- "Include archived" loads every archived thread into the tree, search and filters.

## For agents

The plugin ships two skills, which Cloudroom gives to agents, and a CLI command:

- **`organizar-pastas`**: organize threads into folders with `room-cli thread section ...` and `room-cli thread update <id> --section <sec_id>`.
- **`tags-de-threads`**: tag threads, including the key of the Task the agent is working on.

```sh
room-cli tags list [--thread <id>]          # without --thread: the current thread
room-cli tags add MX-213 review
room-cli tags remove review
room-cli tags set MX-213 urgent             # replace all tags
room-cli tags clear
room-cli tags all --json                    # tags in use + counts
room-cli tags find MX-213 --json            # threads with a tag
room-cli tags rename reveiw review          # across all threads
```

## Install

```sh
room-cli plugin install https://github.com/guilherme-vasques-ltda/cloudroom-bb-search-plugin --yes
```

Or from a local copy: `npm install && room-cli plugin build . && room-cli plugin install . --yes`

To go back to the built-in list: Settings → Appearance → Sidebar.

## Known limits

The plugin uses experimental parts of the Cloudroom SDK. In this version (v151):

- The threads hook returns archived threads and sections empty. The plugin loads both from the API instead.
- Cloudroom's own status glyph and context menu don't work inside the plugin, so it draws its own.
- The plugin can't tell for sure whether a thread runs locally or in the cloud: it shows "cloud" when the thread has no machine.
- A renamed folder can take up to a minute to show its new name.

## Development

`room-cli plugin dev .` rebuilds and reloads on every change. Don't change `name` in `package.json`: it sets the plugin id, and changing it breaks the scoped CSS.

## License

MIT
