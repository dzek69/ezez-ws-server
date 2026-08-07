# Authentication

Every client must authenticate before it can exchange messages with the server. This is a core part of the protocol and cannot be disabled, but you can trivially accept all clients if your use case doesn't require auth.

## Authentication Flow

1. Client connects via WebSocket
2. A timer starts (`authTimeoutMs`, 5 seconds by default) — the client must send its auth key before it expires
3. The client sends its auth key along with the protocol version
4. The server validates the protocol version (currently version 1)
5. Your `onAuthRequest` callback is called with the client and the auth key
6. If you return `true`: the server sends an auth-ok message and calls `onAuthOk`
7. If you return `false` (or throw): the server sends an auth-rejected message, calls `onAuthRejected`, and closes the connection

If the client doesn't send an auth message within the timeout, the server automatically rejects and disconnects it. The timeout only covers sending the auth message — it exists to get rid of bare WebSocket connections that never attempt to authenticate (e.g. random internet bots) and does not limit how long your `onAuthRequest` verification takes.

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

### When `onAuthRequest` Throws

If `onAuthRequest` throws (or its promise rejects) — for example, your database is down — it is treated as an auth failure: the error is passed to `onError`, the client receives an auth-rejected message with the reason `"Auth verification failed"` (the error details are never sent to the client), `onAuthRejected` is called, and the connection is closed.

This is the only callback with such special handling. Every other callback is expected not to throw — see **A Note on Callbacks and Errors** below.

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
    // - "Auth verification failed" (your callback threw or rejected)
    // - "Protocol version mismatch, wanted 1, got X"
    // - "Auth timeout"
},
```

## A Note on Callbacks and Errors

The library expects your callbacks not to throw (and async ones not to reject). They are invoked without any protective try/catch, so an exception escaping a callback is a bug in your code — depending on the context it may surface as an unhandled error or rejection. The only exception is `onAuthRequest`, as described above.

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
