#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Storage path for shared messages
const DATA_DIR = process.env.AGENT_BOARD_DIR || path.join(__dirname, 'data')
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json')

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2), 'utf-8')
  }
}

function loadMessages() {
  ensureStorage()
  try {
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf-8')
    return JSON.parse(raw || '[]')
  } catch (err) {
    return []
  }
}

function saveMessages(messages) {
  ensureStorage()
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf-8')
}

const TOOLS = [
  {
    name: 'agent_post_message',
    description: 'Post a new message, task, architectural note, or status update to the Agent Message Board for Claude or Antigravity.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient agent name (e.g., "claude", "antigravity", "all", or specific team role)',
          default: 'all',
        },
        from: {
          type: 'string',
          description: 'Sender agent name (e.g., "antigravity" or "claude")',
          default: 'antigravity',
        },
        topic: {
          type: 'string',
          description: 'Subject or feature area (e.g., "IIoT Best Practices", "MQTT Security", "Chart Scaling")',
        },
        message: {
          type: 'string',
          description: 'The full message content, technical explanation, instructions, or handoff notes.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          default: 'normal',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (e.g., ["frontend", "security", "timeseries"])',
        },
        artifacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of relevant file paths or commit hashes',
        },
      },
      required: ['topic', 'message'],
    },
  },
  {
    name: 'agent_read_inbox',
    description: 'Read incoming messages, tasks, and updates from the Agent Message Board.',
    inputSchema: {
      type: 'object',
      properties: {
        for_agent: {
          type: 'string',
          description: 'Filter messages addressed to this agent or "all" (e.g., "antigravity", "claude", "all")',
          default: 'all',
        },
        unread_only: {
          type: 'boolean',
          description: 'If true, returns only unread messages.',
          default: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'agent_reply_message',
    description: 'Reply to an existing message thread on the Agent Message Board.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The ID of the parent message to reply to.',
        },
        from: {
          type: 'string',
          description: 'Sender agent name (e.g., "antigravity" or "claude")',
          default: 'antigravity',
        },
        reply: {
          type: 'string',
          description: 'The response or follow-up content.',
        },
      },
      required: ['message_id', 'reply'],
    },
  },
  {
    name: 'agent_mark_as_read',
    description: 'Mark one or more messages as read.',
    inputSchema: {
      type: 'object',
      properties: {
        message_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of message IDs to mark as read.',
        },
      },
      required: ['message_ids'],
    },
  },
  {
    name: 'agent_list_topics',
    description: 'List all active topics, discussions, and task summaries on the board.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

function handleToolCall(name, args) {
  const messages = loadMessages()

  if (name === 'agent_post_message') {
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    const newMsg = {
      id,
      timestamp: new Date().toISOString(),
      to: args.to || 'all',
      from: args.from || 'antigravity',
      topic: args.topic,
      message: args.message,
      priority: args.priority || 'normal',
      tags: args.tags || [],
      artifacts: args.artifacts || [],
      readBy: [],
      replies: [],
    }
    messages.push(newMsg)
    saveMessages(messages)
    return {
      success: true,
      messageId: id,
      note: `Message posted successfully to topic "${args.topic}".`,
    }
  }

  if (name === 'agent_read_inbox') {
    const forAgent = (args.for_agent || 'all').toLowerCase()
    const unreadOnly = !!args.unread_only
    const limit = args.limit || 20

    let filtered = messages.filter((m) => {
      const matchRecipient =
        forAgent === 'all' ||
        m.to.toLowerCase() === 'all' ||
        m.to.toLowerCase() === forAgent
      if (!matchRecipient) return false
      if (unreadOnly && m.readBy && m.readBy.includes(forAgent)) return false
      return true
    })

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    filtered = filtered.slice(0, limit)

    return {
      count: filtered.length,
      totalOnBoard: messages.length,
      messages: filtered,
    }
  }

  if (name === 'agent_reply_message') {
    const target = messages.find((m) => m.id === args.message_id)
    if (!target) {
      return { error: `Message with ID ${args.message_id} not found.` }
    }
    const replyObj = {
      id: 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      from: args.from || 'antigravity',
      reply: args.reply,
    }
    target.replies = target.replies || []
    target.replies.push(replyObj)
    saveMessages(messages)
    return {
      success: true,
      replyId: replyObj.id,
      parentTopic: target.topic,
      totalReplies: target.replies.length,
    }
  }

  if (name === 'agent_mark_as_read') {
    const ids = args.message_ids || []
    const agent = 'antigravity'
    let updated = 0
    for (const m of messages) {
      if (ids.includes(m.id)) {
        m.readBy = m.readBy || []
        if (!m.readBy.includes(agent)) {
          m.readBy.push(agent)
          updated++
        }
      }
    }
    saveMessages(messages)
    return { success: true, markedCount: updated }
  }

  if (name === 'agent_list_topics') {
    const summary = messages.map((m) => ({
      id: m.id,
      timestamp: m.timestamp,
      topic: m.topic,
      from: m.from,
      to: m.to,
      priority: m.priority,
      repliesCount: (m.replies || []).length,
      tags: m.tags || [],
    }))
    return { totalTopics: summary.length, topics: summary }
  }

  throw new Error(`Unknown tool: ${name}`)
}

// Stdio JSON-RPC 2.0 MCP Handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: '2.0',
    id,
  }
  if (error) {
    response.error = error
  } else {
    response.result = result
  }
  process.stdout.write(JSON.stringify(response) + '\n')
}

rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    const req = JSON.parse(line)
    const { id, method, params } = req

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'agent-message-board',
          version: '1.0.0',
        },
      })
      return
    }

    if (method === 'notifications/initialized') {
      // Notification, no reply needed
      return
    }

    if (method === 'ping') {
      sendResponse(id, {})
      return
    }

    if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS })
      return
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params
      try {
        const result = handleToolCall(name, args || {})
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        })
      } catch (toolErr) {
        sendResponse(id, null, {
          code: -32603,
          message: toolErr.message || 'Internal tool execution error',
        })
      }
      return
    }

    if (id !== undefined) {
      sendResponse(id, null, {
        code: -32601,
        message: `Method not found: ${method}`,
      })
    }
  } catch (err) {
    process.stderr.write(`[agent-message-board] Error: ${err.message}\n`)
  }
})
