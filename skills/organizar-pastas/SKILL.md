---
name: organizar-pastas
description: Organize threads into folders (Cloudroom thread sections) inside a project, such as "Reviewers", "Feature X" or "General". Use when asked to organize, group or tidy threads/agents into folders (pastas), or when creating a thread that clearly belongs to an existing group.
---

# Organize threads into folders

Sidebar folders are Cloudroom **thread sections**. A thread is in at most one
folder. A folder exists across projects; the plugin shows, inside each
project, only the folders that hold threads from that project. Child threads
show under their parent, so moving the parent is enough.

## Commands

```sh
room-cli thread section list --json                 # existing folders
room-cli thread section create "Reviewers" --json   # create (returns sec_... id)
room-cli thread section rename <sec_id> "New name"
room-cli thread update <thr_id> --section <sec_id>  # put a thread in a folder
room-cli thread update <thr_id> --clear-section     # take it out
room-cli thread list --project <proj_id> --json     # threads in a project
room-cli thread list --section <sec_id> --json      # threads in a folder
```

## Rules

- Run `section list` first and reuse a folder with the same meaning. No
  duplicates ("Reviewers" and "Review").
- Short names, by role or workstream: "Reviewers", "General", "Feature X",
  "Infra". No dates or ids in names. Use the user's language for names.
- Move only root threads (no `parentThreadId`); children follow their parent.
- Don't delete folders (`section delete`) or touch threads of other projects
  unless explicitly asked.
- When done, say in one line which folders you created and how many threads
  you moved.
