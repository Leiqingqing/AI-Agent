import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

type RealtimeEnv = {
  Bindings: {
    MEETING_CHAT_ROOMS: DurableObjectNamespace
  }
}

type ChatMessage = {
  id: string
  kind: 'chat'
  user: string
  text: string
  sentAt: string
}

type WebSocketSession = {
  user: string
}

const MESSAGES_STORAGE_KEY = 'meeting-room-chat:messages'
const ROOM_STORAGE_KEY = 'meeting-room-chat:room-id'
const MAX_STORED_MESSAGES = 50

const releaseCycleScenario = [
  {
    user: 'Alice',
    text: '这次版本如果同时带上审批流和聊天室，我建议拆成两批上线，先保核心沟通链路。',
  },
  {
    user: 'Bob',
    text: '可以，聊天室本周联调，下周做回归和压测，整体上线周期控制在两周内。',
  },
  {
    user: 'Carol',
    text: '那正式上线窗口先定在 6 月 18 日，前两天灰度，确认稳定后全量发布。',
  },
] as const

const meetingRoomChat = new Hono<RealtimeEnv>()

function buildInternalRequest(url: string, init?: RequestInit) {
  return new Request(url, init)
}

function createChatMessage(user: string, text: string, sentAt = new Date().toISOString()): ChatMessage {
  return {
    id: crypto.randomUUID(),
    kind: 'chat',
    user,
    text,
    sentAt,
  }
}

function parseMessageInput(body: unknown) {
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, {
      message: 'request body must be a JSON object',
    })
  }

  const maybeUser = 'user' in body ? body.user : undefined
  const maybeText = 'text' in body ? body.text : undefined

  if (typeof maybeUser !== 'string' || maybeUser.trim() === '') {
    throw new HTTPException(400, {
      message: 'user must be a non-empty string',
    })
  }

  if (typeof maybeText !== 'string' || maybeText.trim() === '') {
    throw new HTTPException(400, {
      message: 'text must be a non-empty string',
    })
  }

  return {
    user: maybeUser.trim(),
    text: maybeText.trim(),
  }
}

function getRoomStub(c: Parameters<typeof meetingRoomChat.get>[1] extends never ? never : any, roomId: string) {
  const durableObjectId = c.env.MEETING_CHAT_ROOMS.idFromName(roomId)
  return c.env.MEETING_CHAT_ROOMS.get(durableObjectId)
}

meetingRoomChat.get('/', (c) => {
  return c.json({
    topic: 'Cloudflare Durable Object + Hibernatable WebSocket meeting room demo',
    roomId: 'release-planning',
    websocketEndpoint: '/realtime/meeting-room-chat/rooms/release-planning/ws?user=Alice',
    snapshotEndpoint: '/realtime/meeting-room-chat/rooms/release-planning',
    runScenarioEndpoint: 'POST /realtime/meeting-room-chat/rooms/release-planning/scenarios/release-cycle',
    sampleConversation: releaseCycleScenario,
  })
})

meetingRoomChat.get('/scenario/release-cycle', (c) => {
  return c.json({
    success: true,
    title: '会议讨论上线周期',
    messages: releaseCycleScenario,
  })
})

meetingRoomChat.get('/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const stub = getRoomStub(c, roomId)

  return stub.fetch(
    buildInternalRequest('https://meeting-room.internal/snapshot', {
      headers: {
        'x-room-id': roomId,
      },
    }),
  )
})

meetingRoomChat.post('/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId')
  const body = parseMessageInput(await c.req.json())
  const stub = getRoomStub(c, roomId)

  return stub.fetch(
    buildInternalRequest('https://meeting-room.internal/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-room-id': roomId,
      },
      body: JSON.stringify(body),
    }),
  )
})

meetingRoomChat.post('/rooms/:roomId/scenarios/release-cycle', async (c) => {
  const roomId = c.req.param('roomId')
  const stub = getRoomStub(c, roomId)

  return stub.fetch(
    buildInternalRequest('https://meeting-room.internal/scenarios/release-cycle', {
      method: 'POST',
      headers: {
        'x-room-id': roomId,
      },
    }),
  )
})

meetingRoomChat.get('/rooms/:roomId/ws', async (c) => {
  const roomId = c.req.param('roomId')
  const user = c.req.query('user')
  const upgrade = c.req.header('upgrade')

  if (!user) {
    throw new HTTPException(400, {
      message: 'user query parameter is required',
    })
  }

  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    throw new HTTPException(426, {
      message: 'expected a websocket upgrade request',
    })
  }

  const stub = getRoomStub(c, roomId)
  const wsUrl = new URL(c.req.url)
  const headers = new Headers(c.req.raw.headers)

  wsUrl.protocol = 'https:'
  wsUrl.hostname = 'meeting-room.internal'
  wsUrl.pathname = '/websocket'
  wsUrl.search = new URLSearchParams({ user }).toString()
  headers.set('x-room-id', roomId)

  return stub.fetch(
    buildInternalRequest(wsUrl.toString(), {
      method: 'GET',
      headers,
    }),
  )
})

export class MeetingChatRoom implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly _env: CloudflareBindings,
  ) {
    this.state.setHibernatableWebSocketEventTimeout(10_000)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const roomId = request.headers.get('x-room-id') ?? 'release-planning'

    await this.state.storage.put(ROOM_STORAGE_KEY, roomId)

    if (url.pathname === '/websocket') {
      return this.handleWebSocket(request, roomId)
    }

    if (url.pathname === '/snapshot') {
      return Response.json(await this.createSnapshot(roomId))
    }

    if (url.pathname === '/messages' && request.method === 'POST') {
      const body = parseMessageInput(await request.json())
      const message = await this.appendMessage(body.user, body.text)

      this.broadcast({ type: 'chat', roomId, message })

      return Response.json({
        success: true,
        roomId,
        message,
      })
    }

    if (url.pathname === '/scenarios/release-cycle' && request.method === 'POST') {
      const seededMessages = await this.seedReleaseCycleScenario(roomId)

      return Response.json({
        success: true,
        roomId,
        title: '会议讨论上线周期',
        messages: seededMessages,
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const session = ws.deserializeAttachment() as WebSocketSession | null
    const rawMessage = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const parsed = JSON.parse(rawMessage) as { text?: unknown }

    if (!session?.user || typeof parsed.text !== 'string' || parsed.text.trim() === '') {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'websocket messages must be JSON like {"text":"..."}',
        }),
      )
      return
    }

    const roomId = await this.getRoomId()
    const chatMessage = await this.appendMessage(session.user, parsed.text.trim())

    this.broadcast({
      type: 'chat',
      roomId,
      message: chatMessage,
    })
  }

  async webSocketClose(): Promise<void> {
    const roomId = await this.getRoomId()
    this.broadcastPresence(roomId)
  }

  async webSocketError(): Promise<void> {
    const roomId = await this.getRoomId()
    this.broadcastPresence(roomId)
  }

  private async handleWebSocket(request: Request, roomId: string): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 })
    }

    const user = new URL(request.url).searchParams.get('user')?.trim()

    if (!user) {
      return new Response('Missing user query parameter', { status: 400 })
    }

    const webSocketPair = new WebSocketPair()
    const client = webSocketPair[0]
    const server = webSocketPair[1]

    server.serializeAttachment({ user })
    this.state.acceptWebSocket(server, [user])

    const history = await this.listMessages()

    server.send(
      JSON.stringify({
        type: 'sync',
        roomId,
        messages: history,
      }),
    )

    this.broadcastPresence(roomId)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private async getRoomId(): Promise<string> {
    return (await this.state.storage.get<string>(ROOM_STORAGE_KEY)) ?? 'release-planning'
  }

  private async listMessages(): Promise<ChatMessage[]> {
    return (await this.state.storage.get<ChatMessage[]>(MESSAGES_STORAGE_KEY)) ?? []
  }

  private listConnectedUsers(): string[] {
    return this.state
      .getWebSockets()
      .map((socket) => (socket.deserializeAttachment() as WebSocketSession | null)?.user)
      .filter((user): user is string => typeof user === 'string' && user.length > 0)
  }

  private async appendMessage(user: string, text: string, sentAt?: string): Promise<ChatMessage> {
    const messages = await this.listMessages()
    const message = createChatMessage(user, text, sentAt)
    const nextMessages = [...messages, message].slice(-MAX_STORED_MESSAGES)

    await this.state.storage.put(MESSAGES_STORAGE_KEY, nextMessages)

    return message
  }

  private async createSnapshot(roomId: string) {
    const messages = await this.listMessages()

    return {
      success: true,
      roomId,
      connectedUsers: this.listConnectedUsers(),
      messageCount: messages.length,
      messages,
    }
  }

  private broadcast(payload: unknown) {
    const serializedPayload = JSON.stringify(payload)

    for (const socket of this.state.getWebSockets()) {
      socket.send(serializedPayload)
    }
  }

  private broadcastPresence(roomId: string) {
    this.broadcast({
      type: 'presence',
      roomId,
      connectedUsers: this.listConnectedUsers(),
    })
  }

  private async seedReleaseCycleScenario(roomId: string): Promise<ChatMessage[]> {
    const seededMessages: ChatMessage[] = []
    const baseTime = Date.now()

    for (const [index, item] of releaseCycleScenario.entries()) {
      const sentAt = new Date(baseTime + index * 45_000).toISOString()
      const message = await this.appendMessage(item.user, item.text, sentAt)

      seededMessages.push(message)
      this.broadcast({
        type: 'chat',
        roomId,
        message,
      })
    }

    return seededMessages
  }
}

export default meetingRoomChat