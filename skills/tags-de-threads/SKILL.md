---
name: tags-de-threads
description: Add, remove, rename and find tags on Cloudroom threads (e.g. a Task key "MX-213", "review", "urgent"). Use when asked to tag threads, link a thread to a Task, or when starting work on a Task (tag your thread with its key).
---

# Thread tags

Tags show in the sidebar before the last-message time, and are searchable and
filterable ("Tag" filter). A tag shaped like a Task key (`MX-213`) is
highlighted in amber: that is how a thread is linked to a Task.

## Commands

Without `--thread`, commands apply to the current thread.

```sh
room-cli tags list [--thread <thr_id>]
room-cli tags add MX-213 review [--thread <thr_id>]
room-cli tags remove review [--thread <thr_id>]
room-cli tags set MX-213 urgent [--thread <thr_id>]   # replace all
room-cli tags clear [--thread <thr_id>]
room-cli tags all --json                              # tags in use + counts
room-cli tags find MX-213 --json                      # threads with the tag
room-cli tags rename reveiw review                    # across all threads
```

## Rules

- When you take on a Task, add its key as a tag on your thread; keep it when
  you finish (it is history).
- Before creating a new tag, check `tags all` and reuse the existing spelling.
- Short tags, lowercase for topics ("review", "infra"); Task keys uppercase as
  on the board. Use the user's language for topic tags.
- Don't rename or clear tags on other threads unless asked.
