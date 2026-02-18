# Configuration

The `EZEZWebsocketServer` constructor accepts two arguments: **options** and **callbacks**.

## Options

Options are a combination of `EZEZServerOptions` (which extends the native `ws` `ServerOptions`) and `ClientOptions`.

### Server Options

These are passed through to the underlying `ws` `WebSocketServer`. The most commonly used ones:

| Option | Type | Description |
|---|---|---|
| `port` | `number` | Port to listen on (standalone mode) |
| `server` | `http.Server` | Existing HTTP server to attach to (external server mode) |
| `noServer` | `boolean` | Enable manual upgrade handling |
| `path` | `string` | Accept connections only on this path (e.g., `"/ws"`) |
| `host` | `string` | Hostname to bind to |

You must provide exactly one of `port`, `server`, or `noServer`.

For the full list of `ws` options, see the [ws documentation](https://github.com/websockets/ws/blob/master/doc/ws.md#new-websocketserveroptions-callback).

### Serialization Options

Before the data is being send it's serialized via `serializeToBuffer` function from `@ezez/utils`.
When data is received it's deserialized with `unserializeFromBuffer`.

Please refer to the docs:
- https://ezez.dev/docs/utils/latest/functions/index.serializeToBuffer.html
- https://ezez.dev/docs/utils/latest/functions/index.unserializeFromBuffer.html

You can customize the process by providing custom serializers/deserializers.

| Option | Type                           | Default | Description |
|---|--------------------------------|---|---|
| `serializerArgs` | `[CustomSerializers, Options]` | `[]` | Custom arguments passed to `@ezez/utils` `serializeToBuffer`. Your custom serializer must be compatible with the deserializer on the client side. |
| `unserializerArgs` | `[CustomDeserializers]`        | `[]` | Custom arguments passed to `@ezez/utils` `unserializeFromBuffer`. Your custom unserializer must be compatible with the serializer on the client side. |

### Client Behavior Options

| Option | Type | Default | Description |
|---|---|---|---|
| `messagesBeforeAuth` | `"ignore" \| "queue" \| "accept"` | `"ignore"` | How to handle messages received before authentication completes |
| `sendAfterDisconnect` | `"ignore" \| "throw"` | `"ignore"` | What happens when you try to send a message to a disconnected client |
| `clearAwaitingRepliesAfterMs` | `number` | `300000` (5 min) | How long to wait before cleaning up unanswered reply callbacks. Must be greater than 0. |

#### `messagesBeforeAuth`

Controls what happens when a client sends messages before completing authentication:

- **`"ignore"`** (default) — Messages are silently dropped. Safest option.
- **`"queue"`** — Messages are stored in a buffer. If authentication succeeds, they are processed in order. If authentication fails, the queue is discarded.
- **`"accept"`** — Messages are processed immediately, regardless of auth state. Use this only if you have a specific need to handle unauthenticated messages and understand the implications.

#### `sendAfterDisconnect`

Controls what happens when server code tries to send a message to a client that has already disconnected:

- **`"ignore"`** (default) — The `send()` call silently returns `undefined`. No error.
- **`"throw"`** — Throws an error. Useful during development to catch bugs where you're sending to stale client references.

#### `clearAwaitingRepliesAfterMs`

When you send a message with an `onReply` callback, the library tracks that it's expecting a reply. If the reply never comes (client disconnected, bug, etc.), this timer ensures the callback is cleaned up to prevent memory leaks.

The cleanup check runs every 15 seconds. This means the actual cleanup time may be up to 15 seconds longer than the configured value.

After a stale reply is cleaned up, if the reply eventually arrives it will be handled through the normal `onMessage` and `client.on()` flow instead of the original `onReply` callback.

## Callbacks

| Callback | Required | Description |
|---|---|---|
| `onAuthRequest` | Yes | Validate client authentication. Return `true` to accept, `false` to reject. |
| `onAuthOk` | No | Called after successful authentication |
| `onAuthRejected` | No | Called when authentication fails (invalid key, timeout, or version mismatch) |
| `onMessage` | No | Called for every incoming message from any authenticated client |
| `onDisconnect` | No | Called when a client disconnects |
| `onError` | No | Called when a WebSocket error occurs on a client connection |

### `onAuthRequest`

```typescript
onAuthRequest: (client: EZEZServerClient, auth: string) => Promise<boolean>
```

The only required callback. Receives the client and the auth string. Must return a promise that resolves to `true` (accept) or `false` (reject).

### `onAuthOk`

```typescript
onAuthOk?: (client: EZEZServerClient) => void
```

Called after successful authentication. Set up per-client event listeners and send initial data here.

### `onAuthRejected`

```typescript
onAuthRejected?: (client: EZEZServerClient, reason: string) => void
```

Called when authentication fails. The `reason` parameter describes why: `"Invalid auth key"`, `"Auth timeout"`, or a protocol version mismatch message.

### `onMessage`

```typescript
onMessage?: (client, eventName, args, reply, ids) => void
```

Called for every incoming message. Parameters:
- `client` — The client that sent the message
- `eventName` — The event name (typed as a key of `IncomingEvents`)
- `args` — The event arguments (typed tuple)
- `reply` — A function to send a reply linked to this message
- `ids` — `{ eventId, replyTo }` message identifiers

This callback is called before `onReply()` or `client.on()` callbacks.

### `onDisconnect`

```typescript
onDisconnect?: (client: EZEZServerClient, code: number, reason: string) => void
```

Called when a client disconnects. The `code` and `reason` follow the WebSocket close frame specification.

### `onError`

```typescript
onError?: (client: EZEZServerClient, error: Error) => void
```

Called when a WebSocket error occurs on the client's connection.
