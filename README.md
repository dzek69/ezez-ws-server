# @ezez/ws-server

Type-safe WebSocket server with built-in authentication and reply tracking. Server-side part of the `@ezez/ws-client`
/ `@ezez/ws-server` pair.

Built on top of [`ws`](https://github.com/websockets/ws).

## Features

- **Type-safe messaging** - define your events as TypeScript types, get full type checking on both sending and receiving
- **Built-in authentication** - every client goes through an auth flow before exchanging messages. You can validate tokens, check credentials, or simply accept everyone - it's up to your callback
- **Reply tracking** - send a message and register a callback for when the client replies to that specific message, enabling request-response patterns over WebSocket
- **Flexible server modes** - run standalone, attach to an existing HTTP server (Express, Fastify, etc.), or handle WebSocket upgrades manually
- **Broadcasting** - send a message to all connected clients with a single call
- **Data flexibility** - send plain text or binary data. Mix them together. Exchange any data type, including `undefined`, `bigint`, `Date` or your own instances

## Client features

- tbd

## Installation

```bash
npm install @ezez/ws-server
```

You also need `@ezez/ws-client` on the client side. The two libraries use a shared binary protocol and must be used
together.

## Quick Example

```typescript
import { EZEZWebsocketServer } from "@ezez/ws-server";

type FromClient = {
    ping: [message: string];
};

type FromServer = {
    pong: [message: string];
};

const server = new EZEZWebsocketServer<FromClient, FromServer>(
    { port: 8080 },
    {
        onAuthRequest: async (client, authKey) => authKey === "secret",
        onAuthOk: (client) => {
            client.send("pong", ["connected!"]);

            client.on("ping", (args, reply) => {
                const [message] = args;
                reply("pong", [`you said: ${message}`]);
            });
        },
    },
);

await server.start();
```

## Goals

- **Simplicity** - a thin, opinionated wrapper over `ws` that removes boilerplate without hiding the WebSocket
- **Type safety** - catch event name typos and argument mismatches at compile time, not at runtime
- **Built-in auth** - authentication is part of the protocol so you never forget to handle it

## Non-goals

- **Not a Socket.IO replacement** - no rooms, namespaces, or channel abstractions. If you need to group clients, manage
  that in your application code
- **No HTTP fallback** - WebSocket only, no long-polling or SSE. If the client can't establish a WebSocket connection,
  this library won't help

## Documentation

Full documentation is available here: https://ezez.dev/docs/ws-server/latest/

## License

MIT
