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
| `maxPayload` | `number` | Max size (bytes) of a single incoming message. This library defaults it to 1 MiB (the `ws` default is 100 MiB). A message exceeding it always closes the connection (close code 1009) — `ws` enforces the limit while the frame is still being received, so oversized frames are never fully buffered. |

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
| `authTimeoutMs` | `number` | `5000` (5 s) | How long a client has to send its auth message before being rejected and disconnected. Must be greater than 0. |
| `queueLimitBytes` | `number` | `1048576` (1 MiB) | Max total size of messages queued before auth (`messagesBeforeAuth: "queue"`). Must be greater than 0. |
| `queueOverflow` | `"ignore" \| "disconnect" \| callback` | `"ignore"` | What to do with a pre-auth message that would overflow the queue |
| `clearAwaitingRepliesAfterMs` | `number` | `300000` (5 min) | How long to wait before cleaning up unanswered reply callbacks. Must be greater than 0. |
| `defaultContext` | `TContext` | `{}` | Initial value for `client.context`, deep-cloned per connection via `structuredClone`. Required when the `TContext` generic is specified, optional otherwise. See the **Per-Client Context** page. |

#### `messagesBeforeAuth`

Controls what happens when a client sends messages before completing authentication:

- **`"ignore"`** (default) — Messages are silently dropped. Safest option.
- **`"queue"`** — Messages are stored in a buffer. If authentication succeeds, they are processed in order. If authentication fails, the queue is discarded.
- **`"accept"`** — Messages are processed immediately, regardless of auth state. Use this only if you have a specific need to handle unauthenticated messages and understand the implications.

#### `sendAfterDisconnect`

Controls what happens when server code tries to send a message to a client that has already disconnected:

- **`"ignore"`** (default) — The `send()` call silently returns `undefined`. No error.
- **`"throw"`** — Throws an error. Useful during development to catch bugs where you're sending to stale client references.

#### `authTimeoutMs`

Time the client has to send its auth message. This rejects bare WebSocket connections that never attempt to authenticate (e.g. random internet bots). It only covers sending the auth message — it does not limit how long your `onAuthRequest` verification takes.

#### `queueLimitBytes` and `queueOverflow`

With `messagesBeforeAuth: "queue"`, messages received before authentication completes are buffered in memory. `queueLimitBytes` limits the total buffered size per client, and `queueOverflow` controls what happens with a message that would not fit:

- **`"ignore"`** (default) — The message is silently dropped; the connection and the already queued messages are kept.
- **`"disconnect"`** — The connection is closed with code `1008` (policy violation).
- **callback** `(client, byteLength) => void` — The message is dropped and your callback is called, e.g. to send an error message back to the client or to disconnect it. The connection stays open.

The queue (and its byte counter) is discarded once authentication succeeds or the connection closes.

Since a single message is limited by `maxPayload` (see Server Options above), with `messagesBeforeAuth: "queue"` the server requires `maxPayload` ≤ `queueLimitBytes` at construction time — otherwise a single legal message could never fit in the queue.

```typescript
const server = new EZEZWebsocketServer<MyEvents>(
    {
        port: 8080,
        messagesBeforeAuth: "queue",
        queueLimitBytes: 256 * 1024, // 256 KiB
        maxPayload: 64 * 1024, // 64 KiB
        queueOverflow: (client, byteLength) => {
            client.send("error", [`Too many messages queued before auth (${byteLength} bytes dropped)`]);
        },
    },
    { onAuthRequest: async () => true },
);
```

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

Callbacks are expected not to throw (and async ones not to reject) — they are invoked without any protective try/catch, so an escaping exception is a bug in your code. The only exception is `onAuthRequest`: its throw/rejection is treated as an auth failure (reported via `onError`, client rejected and disconnected).

### `onAuthRequest`

```typescript
onAuthRequest: (client: EZEZServerClient, auth: string) => Promise<boolean>
```

The only required callback. Receives the client and the auth string. Must return a promise that resolves to `true` (accept) or `false` (reject). If it throws or rejects, the client is rejected with the reason `"Auth verification failed"` and the error is reported via `onError`.

### `onAuthOk`

```typescript
onAuthOk?: (client: EZEZServerClient) => void
```

Called after successful authentication. Set up per-client event listeners and send initial data here.

### `onAuthRejected`

```typescript
onAuthRejected?: (client: EZEZServerClient, reason: string) => void
```

Called when authentication fails. The `reason` parameter describes why: `"Invalid auth key"`, `"Auth verification failed"`, `"Auth timeout"`, or a protocol version mismatch message.

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
