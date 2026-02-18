# Getting Started

## Installation

```bash
npm install @ezez/ws-server
```

## Quick Example

Here's a minimal WebSocket server with authentication and type-safe messaging:

```typescript
import { EZEZWebsocketServer } from "@ezez/ws-server";

// Define what events clients can send to the server
type IncomingEvents = {
    greet: [name: string];
    sum: [a: number, b: number];
};

// Define what events the server can send to clients
type OutgoingEvents = {
    welcome: [message: string];
    result: [value: number];
};

const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { port: 8080 },
    {
        onAuthRequest: async (client, authKey) => {
            // Validate the auth key sent by the client
            return authKey === "my-secret-key";
        },
        onAuthOk: (client) => {
            client.send("welcome", ["You are connected!"]);
        },
        onMessage: (client, eventName, args, reply, ids) => {
            console.log("Received:", eventName, args);
        },
    },
);

await server.start();
console.log("Server listening on port 8080");
```

## How It Works

1. A client connects via WebSocket
2. The client must authenticate within 5 seconds by sending an auth key
3. Your `onAuthRequest` callback decides whether to accept or reject
4. Once authenticated, the client can send and receive typed messages

## Sending Messages

After authentication, you can send messages to individual clients or broadcast to all:

```typescript
// Send to a specific client
client.send("welcome", ["Hello!"]);

// Broadcast to all connected clients
server.broadcast("result", [42]);
```

## Listening for Events

There are two ways to handle incoming messages:

### Per-event listeners with `client.on()`

Listen for specific events on individual clients:

```typescript
onAuthOk: (client) => {
    client.on("greet", (args, reply) => {
        const [name] = args;
        reply("welcome", [`Hello, ${name}!`]);
    });

    client.on("sum", (args, reply) => {
        const [a, b] = args;
        reply("result", [a + b]);
    });
}
```

### Global `onMessage` callback

Receives every message from every client:

```typescript
const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { port: 8080 },
    {
        onAuthRequest: async () => true,
        onMessage: (client, eventName, args, reply, ids) => {
            if (eventName === "greet") {
                const [name] = args;
                reply("welcome", [`Hello, ${name}!`]);
            }
        },
    },
);
```

## Next Steps

- **Authentication** - Learn about the authentication flow in detail
- **Events & Messaging** - Type-safe event handling and messaging patterns
- **Reply System** - Request-response patterns with reply tracking
- **Server Modes** - Standalone, Express, Fastify, and manual upgrade
- **Configuration** - All available options explained
