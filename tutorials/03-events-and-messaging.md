# Events & Messaging

`@ezez/ws-server` uses TypeScript generics to provide fully type-safe messaging between server and clients.

## Defining Event Types

Events are defined as TypeScript types that map event names to tuples of arguments:

```typescript
// Events that clients send to the server
type IncomingEvents = {
    chat: [message: string, channel: string];
    move: [x: number, y: number, z: number];
    ping: [];
};

// Events that the server sends to clients
type OutgoingEvents = {
    chatMessage: [sender: string, message: string, channel: string];
    position: [playerId: string, x: number, y: number, z: number];
    pong: [];
};
```

Each key is an event name and the value is a tuple of the arguments that come with that event.

### Bidirectional Events

If clients and server use the same event types, you can omit the second generic parameter:

```typescript
type Events = {
    ping: [];
    pong: [];
    message: [text: string];
};

// IncomingEvents and OutgoingEvents will both be `Events`
const server = new EZEZWebsocketServer<Events>({ port: 8080 }, callbacks);
```

### Reserved Event Names

Event names starting with `ezez-ws::` are reserved for the internal protocol (ie: authentication messages). TypeScript will prevent you from using them in your event definitions.

## Sending Messages

### To a Single Client

Use `client.send()` to send a typed message:

```typescript
client.send("chatMessage", ["Alice", "Hello!", "general"]);
```

The event name and arguments are type-checked against `OutgoingEvents`.

### Broadcasting

Use `server.broadcast()` to send a message to all connected clients:

```typescript
server.broadcast("position", ["player1", 10, 20, 0]);
```

### Return Value

`client.send()` returns an `Ids` object containing the `eventId` of the sent message and `replyTo` if this is a reply, or `undefined` if the message was not sent (because the client is disconnected and `sendAfterDisconnect` is `"ignore"`):

```typescript
const ids = client.send("pong", []);
if (ids) {
    console.log("Sent message with eventId:", ids.eventId);
}
```

> Remember: Ids are unique per connection. After client reconnects it may send the same ids as before.

## Reply vs Send

Both `reply` and `client.send` send messages to the client, but they differ in one important way:

- **`client.send()`** — Sends a new, standalone message
- **`reply()`** — Sends a message that is linked to the incoming message. If the sender registered an `onReply` callback for the original message, the reply will be routed there instead of going through the normal `on()` flow. `onMessage` is always called.

See the **Reply System** page for details on reply tracking.

## Receiving Messages

### Per-Event Listeners

You can use `client.on()` to listen for specific events:

```typescript
onAuthOk: (client) => {
    client.on("chat", (args, reply, ids) => {
        const [message, channel] = args; // types are inferred
        // handle chat message
    });

    client.on("move", (args, reply, ids) => {
        const [x, y, z] = args; // types are inferred
        // handle movement
    });
},
```

The callback parameters are:

| Parameter   | Description                                  |
|-------------|----------------------------------------------|
| `eventName` | The event name                               |
| `args`      | The event arguments as a typed tuple         |
| `reply`     | A function to reply to this specific message |
| `ids`       | Message identifiers                          |

You can also use `client.once()` for one-time listeners:

```typescript
client.once("ping", (args, reply) => {
    reply("pong", []);
});
```

And `client.off()` to remove listeners:

```typescript
const handler = (args, reply, ids) => { /* ... */ };
client.on("chat", handler);
// later:
client.off("chat", handler);
```

> **IMPORTANT!** Any message that is a reply to specific event is only catchable via `onReply` callback defined when sending the message and `onMessage` global callback.
`client.on()` and `client.once()` won't register a reply, even when eventName matches!

### Global `onMessage` Callback

The `onMessage` callback receives every message from every client. It may be useful for logging purposes. It is called before client event-specific `on` callbacks and `onReply` callbacks.
The callback parameters are the same, with exception of extra first parameter, which is client instance.

```typescript
onMessage: (client, eventName, args, reply, ids) => {
    console.log(`Received event ${eventName} with args`, args);
},
```

### Typing External Handlers with `OnCallback`

When you want to define event handlers outside of the inline `client.on()` call, use the `OnCallback` type helper to get proper typing:

```typescript
import { EZEZWebsocketServer, type OnCallback } from "@ezez/ws-server";

const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(options, callbacks);

// The handler gets full type inference for args, reply, and ids
const chatHandler: OnCallback<typeof server, "chat"> = (args, reply, ids) => {
    const [message, channel] = args; // correctly typed
    reply("chatMessage", ["Server", message, channel]); // type-checked
};

// Use it later
client.on("chat", chatHandler);
```
