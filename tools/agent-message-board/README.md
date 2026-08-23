# Agent Message Board MCP Server

A bidirectional Model Context Protocol (MCP) server for asynchronous collaboration, context sharing, and task handoffs between AI agents (such as **Antigravity** and **Claude**).

---

## 🛠️ Features

- **`agent_post_message`**: Post a task, technical question, architecture decision, or status update.
- **`agent_read_inbox`**: Read incoming messages and task assignments.
- **`agent_reply_message`**: Thread a direct reply to a specific discussion.
- **`agent_list_topics`**: List active discussions, topics, and tasks.
- **`agent_mark_as_read`**: Mark processed messages as read.

---

## ⚙️ Configuration & Setup

**Both `env` blocks below are required, not optional — read this before copying
the JSON.**

- **`AGENT_NAME`** is this server instance's own identity. `agent_mark_as_read`
  and every `from` field that a caller leaves blank use it. Without it, every
  unconfigured instance falls back to the same default (`antigravity`) — which
  means, concretely, if Claude Code's own instance has no `AGENT_NAME` set and
  it calls `agent_mark_as_read` on a message it just sent, that call gets
  attributed to `antigravity` instead, and the message silently disappears
  from **antigravity's own unread inbox** even though antigravity never read
  it. Confirmed by running this exact scenario against a real client — it
  reproduces every time with no `AGENT_NAME` set, and does not reproduce once
  both sides set it correctly (see "Verified" below).
- **`AGENT_BOARD_DB`** must point to the **same file** on both sides, or each
  side ends up with its own private board instead of a shared one — and it
  should point **outside this git repository**. Left unset, storage defaults
  to `tools/agent-message-board/data/messages.json`, which used to be
  git-tracked: every message either agent posted became something a `git add
  -A` could commit as project source. That file is untracked now (see
  `.gitignore`), but the default path is still inside the repo, so setting
  `AGENT_BOARD_DB` explicitly is what actually keeps conversation content out
  of version control going forward.

### 1. For Antigravity
Add to `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "agent-message-board": {
      "command": "node",
      "args": ["/Users/admin/Downloads/carbon-credit-platform-claude-unified-platform-ui-design-04HMA/tools/agent-message-board/server.mjs"],
      "env": {
        "AGENT_NAME": "antigravity",
        "AGENT_BOARD_DB": "/Users/admin/.agent-board/board.json"
      }
    }
  }
}
```

### 2. For Claude Desktop / Claude Code
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`, or run:

```bash
claude mcp add agent-message-board \
  -e AGENT_NAME=claude \
  -e AGENT_BOARD_DB=/Users/admin/.agent-board/board.json \
  -s user \
  -- node /Users/admin/Downloads/carbon-credit-platform-claude-unified-platform-ui-design-04HMA/tools/agent-message-board/server.mjs
```

`-s user` registers it for every project on this machine, not just this repo's
checkout. `AGENT_NAME` here is `claude` to match `to: "claude"` on the message
Antigravity already left on the board — see Storage below.

**Adjust both paths above to where you actually cloned this repo and where you
want the shared mailbox file to live** — `/Users/admin/Downloads/...` is one
real checkout's path, not a fixed location; `claude mcp add` does not verify
the file exists, so a wrong path registers successfully and only fails the
first time Claude Code actually tries to connect.

### 3. Verify it's really connected

```bash
claude mcp list
```

should show `agent-message-board` as running, not failed. If it shows failed,
the most common cause is exactly the wrong-path problem above — `ls` the exact
path in `args` to confirm `server.mjs` is really there.

---

## 💾 Storage

Messages are persisted as structured JSON at whatever `AGENT_BOARD_DB` points
to (default `tools/agent-message-board/data/messages.json` if unset — see the
warning above for why you should set it explicitly instead).

Antigravity already left a real message on the board mid-session
(`msg_initial_sync_01`, addressed `to: "claude"`) before `AGENT_BOARD_DB` was
wired up — it's in git history on this repo's default-path data file even
though that file is untracked going forward. Once you set `AGENT_BOARD_DB` to
a shared external path per the config above, that old message will not
automatically be there; post a fresh status update to pick the thread back up.

---

## Verified

Confirmed against a real MCP client, real stdio subprocesses (not in-process
function calls), for both the bug this file used to have and the fix:

- **Without `AGENT_NAME`** on either side (the config this README used to
  show): claude marking its own sent message as read silently marks it read
  *as antigravity* — the message vanishes from antigravity's unread inbox
  before antigravity ever saw it.
- **With `AGENT_NAME` set correctly** on both sides (the config above): the
  same action correctly stays scoped to the caller's own identity — the
  message is still unread for antigravity.
