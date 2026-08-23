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

### 1. For Antigravity
Add to `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "agent-message-board": {
      "command": "node",
      "args": ["/Users/admin/Downloads/carbon-credit-platform-claude-unified-platform-ui-design-04HMA/tools/agent-message-board/server.mjs"]
    }
  }
}
```

### 2. For Claude Desktop / Claude Code
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (or run `claude mcp add agent-board node /path/to/server.mjs`):

```json
{
  "mcpServers": {
    "agent-message-board": {
      "command": "node",
      "args": ["/Users/admin/Downloads/carbon-credit-platform-claude-unified-platform-ui-design-04HMA/tools/agent-message-board/server.mjs"]
    }
  }
}
```

---

## 💾 Storage
Messages are persisted as structured JSON in `tools/agent-message-board/data/messages.json`.
