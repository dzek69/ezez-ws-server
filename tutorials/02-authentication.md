# Authentication

Every client must authenticate before it can exchange messages with the server. This is a core part of the protocol and cannot be disabled, but you can trivially accept all clients if your use case doesn't require auth.

## Authentication Flow

1. Client connects via WebSocket
2. A 5-second timer starts — the client must send its auth key before it expires
3. The client sends its auth key along with the protocol version
4. The server validates the protocol version (currently version 1)
5. Your `onAuthRequest` callback is called with the client and the auth key
6. If you return `true`: the server sends an auth-ok message and calls `onAuthOk`
7. If you return `false`: the server sends an auth-rejected message, calls `onAuthRejected`, and closes the connection

If the client doesn't send an auth message within 5 seconds, the server automatically rejects and disconnects it.

## The `onAuthRequest` Callback

This is the only required callback. It receives the client and the auth string, and must return a `Promise<boolean>`:

```typescript
const server = new EZEZWebsocketServer<MyEvents>(
    { port: 8080 },
    {
        onAuthRequest: async (client, authKey) => {
            // Simple key check
            return authKey === "secret";
        },
    },
);
```

You can perform async operations like database lookups:

```typescript
onAuthRequest: async (client, authKey) => {
    const token = await verifyJWT(authKey);
    if (!token) return false;

    const user = await db.users.findById(token.userId);
    return user !== null;
},
```

### Accepting All Clients

If you don't need authentication, simply return `true`:

```typescript
onAuthRequest: async () => true,
```

## The `onAuthOk` Callback

Called after successful authentication. This is a good place to set up per-client event listeners and send initial data:

```typescript
onAuthOk: (client) => {
    console.log(`Client ${client.connectionId} authenticated`);

    // Set up per-client listeners
    client.on("getProfile", (args, reply) => {
        reply("profile", [{ name: "Alice" }]);
    });

    // Send initial data
    client.send("serverInfo", [{ version: "1.0" }]);
},
```

## The `onAuthRejected` Callback

Called when authentication fails (either your callback returned `false`, the protocol version didn't match, or the auth timeout expired):

```typescript
onAuthRejected: (client, reason) => {
    console.log(`Client rejected: ${reason}`);
    // reason is one of:
    // - "Invalid auth key" (your callback returned false)
    // - "Protocol version mismatch, wanted 1, got X"
    // - "Auth timeout"
},
```

## Messages Before Authentication

By default, any messages sent by the client before authentication completes are silently ignored. You can change this behavior with the `messagesBeforeAuth` option:

```typescript
const server = new EZEZWebsocketServer<MyEvents>(
    {
        port: 8080,
        messagesBeforeAuth: "queue", // or "ignore" (default) or "accept"
    },
    { onAuthRequest: async () => true },
);
```

- `"ignore"` (default) — Messages sent before auth are silently dropped, with a proper client-side code this should never occur, so we recommend to keep this default
- `"queue"` — Messages are queued and automatically processed after successful auth
- `"accept"` — Messages are processed immediately, even before auth completes. This puts the burden on you to handle unauthenticated messages properly.

See the **Configuration** page for more details.
