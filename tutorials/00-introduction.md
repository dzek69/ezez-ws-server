# Introduction

`@ezez/ws-server` is the server-side part of the `@ezez/ws-client` / `@ezez/ws-server` pair. It provides a type-safe, opinionated WebSocket server built on top of the [`ws`](https://github.com/websockets/ws) library.

## Why This Library?

Working with raw WebSocket servers means writing the same boilerplate over and over: parsing messages, routing events, handling authentication, tracking request-response pairs. This library handles all of that while adding TypeScript type safety on top.

You define your events as TypeScript types:

```typescript
type FromClient = {
    sendMessage: [text: string, channel: string];
    getHistory: [channel: string, limit: number];
};

type FromServer = {
    newMessage: [sender: string, text: string, channel: string];
    history: [messages: Array<{ sender: string; text: string }>];
};
```

And the library enforces these types everywhere — when you send a message, receive one, or register an event listener. Typos in event names or wrong argument types are caught at compile time.

## Core Concepts

### Authentication Is Required

Every client must authenticate after connecting. This is baked into the protocol — you provide an `onAuthRequest` callback that receives the client and an auth string, and you decide whether to accept or reject.

If your use case doesn't need authentication, you can simply always return `true`:

```typescript
onAuthRequest: async () => true
```

You can decide what to do if client tries to send non-auth message before auth is accepted.

> Alternatively: With no server mode you can also validate your users via Cookies or url params if you prefer.

### Every message is an event

Instead of sending and parsing raw strings or JSON, you work with named events that carry typed argument tuples. You can send text data, binary data, mix them (binary data is send without JSON overhead).
There is a custom serialization method used, which allows you to pass values not supported by `JSON.stringify`, like `bigint`, `undefined` or even instances like `Date` or any instance you like.

```typescript
const rawImageData: Buffer = Buffer.from(/* ... */);
const info: { size: bigint; name: string; createdAt: Date } = { size: 123456n, name: "IMG_001.jpg", createdAt: new Date() };
client.send("picture", [rawImageData, info]);
```

### Replies

When you receive a message, the library gives you a `reply` function alongside the event data. Replies are linked to the original message — if the sender registered a callback for the reply, it gets routed directly there instead of going through the normal event handlers. This enables clean request-response patterns without manual correlation.

```typescript
// client size:
ezez.send("instantMessage", ["Hi there!"], (response) => {
    alert("got response!");
    console.log(response);
});

// server side:
client.on("instantMessage", (data, reply) => {
    prepareResponse(data).then((response) => {
        reply("response", [response]);
    });
});
```

### Server Modes

The library supports three ways to run:

- **Standalone** — pass a `port` and the library creates its own HTTP server
- **External server** — pass an existing `server` (from Express, Fastify, Node's `http`, etc.) and share the port
- **Manual upgrade** — pass `noServer: true` and handle WebSocket upgrades yourself for full control

## Next Steps

Head to the **Getting Started** page to install the library and create your first server.
