# Server Modes

`@ezez/ws-server` supports three ways to run the WebSocket server, depending on whether you need it standalone or integrated with an existing HTTP server.

## Standalone Mode

The simplest mode. The server creates its own HTTP server and listens on the specified port:

```typescript
const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { port: 8080 },
    callbacks,
);

await server.start();
// Server is listening on ws://localhost:8080
```

The `start()` promise resolves once the server is ready to accept connections. If the port is already in use, the promise rejects.

## External Server Mode

Attach to an existing HTTP server. This is useful when you want to serve both HTTP and WebSocket on the same port, for example with Express or Fastify:

### With Express

```typescript
import express from "express";
import { createServer } from "http";
import { EZEZWebsocketServer } from "@ezez/ws-server";

const app = express();
const httpServer = createServer(app);

app.get("/health", (req, res) => res.send("OK"));

const wss = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { server: httpServer },
    callbacks,
);

await wss.start();
httpServer.listen(8080);
```

### With Fastify

```typescript
import fastify from "fastify";
import { EZEZWebsocketServer } from "@ezez/ws-server";

const app = fastify();
const wss = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { server: app.server },
    callbacks,
);

await app.listen({ port: 8080 });
await wss.start();
```

In external server mode, `start()` resolves immediately since the underlying HTTP server manages the listening lifecycle.

## Manual Upgrade Mode (`noServer`)

For full control over WebSocket upgrade handling. You manage the HTTP upgrade yourself and decide which requests get upgraded:

```typescript
import { createServer } from "http";
import { EZEZWebsocketServer } from "@ezez/ws-server";

const httpServer = createServer();

const wss = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { noServer: true },
    callbacks,
);

await wss.start();

httpServer.on("upgrade", (request, socket, head) => {
    // Custom logic: check path, headers, etc.
    if (request.url === "/ws") {
        wss.wss!.handleUpgrade(request, socket, head, (ws) => {
            wss.wss!.emit("connection", ws, request);
        });
    } else {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
    }
});

httpServer.listen(8080);
```

### With Fastify (Manual)

```typescript
import fastify from "fastify";
import { EZEZWebsocketServer } from "@ezez/ws-server";

const app = fastify();

const wss = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { noServer: true },
    callbacks,
);

await app.listen({ port: 8080 });
await wss.start();

app.server.on("upgrade", (request, socket, head) => {
    if (request.url === "/ws") {
        wss.wss!.handleUpgrade(request, socket, head, (ws) => {
            wss.wss!.emit("connection", ws, request);
        });
    } else {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
    }
});
```

This gives you the ability to:
- Route different paths to different WebSocket servers
- Add custom authentication at the HTTP level (before WebSocket auth)
- Reject connections based on headers or origin
- Integrate with frameworks that need explicit upgrade control

## Choosing a Mode

| Mode | Use When |
|---|---|
| **Standalone** (`port`) | WebSocket-only server, no HTTP endpoints needed |
| **External server** (`server`) | Sharing a port with an HTTP framework (Express, Fastify, etc.) |
| **Manual upgrade** (`noServer`) | You need full control over which HTTP upgrades become WebSocket connections |
