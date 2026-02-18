# Reply System

`@ezez/ws-server` includes a built-in request-response mechanism that lets you track which message is a reply to which. This enables conversational patterns where you send a message and wait for a specific response.

## How It Works

Every message in the protocol has two IDs:
- **`eventId`** — A unique ID assigned to this message by the sender
- **`replyTo`** — The `eventId` of the message this is replying to, or `null`

When you use `client.send()` with an `onReply` callback, the library remembers that you're waiting for a reply to that specific `eventId`. When a message arrives with a matching `replyTo`, it is routed directly to your `onReply` callback instead of going through the normal `client.on()` flow. `onMessage` global callback is always called.

> Note: Sending a reply when it was not expected (not registered with onCallback) won't result in missed events however. In this case the event will be emitted for `on()` callbacks as usual.

## Using Replies

### Server-Side: Replying to a Client

When you receive a message, the `reply` function is provided as a parameter. Use it to send a response that is linked to the incoming message:

```typescript
onMessage: (client, eventName, args, reply, ids) => {
    if (eventName === "getData") {
        const [id] = args;
        const data = database.get(id);
        reply("data", [data]);
    }
},
```

Or with per-event listeners:

```typescript
client.on("getData", (args, reply) => {
    const [id] = args;
    const data = database.get(id);
    reply("data", [data]);
});
```

> As you may notice - replies event names can be any valid event name. You could ie: respond with `data` or `noData` event for this `getData` request.

### Server-Side: Expecting a Reply

You can also send a message and register a callback for when the client replies:

```typescript
client.send("question", ["What is your name?"], (client, eventName, args, reply, ids) => {
    // This callback fires when the client replies to this specific message
    console.log("Client replied with:", eventName, args);

    // You can even chain replies
    reply("thanks", ["Got it!"], (client, eventName, args) => {
        console.log("Client replied to our thanks:", eventName, args);
    });
});
```

### Reply Chaining

Replies can be chained to create conversational flows, although this feature is most handy for single request-reply flow.

```typescript
client.send("step1", ["start"], (client, eventName, args, reply) => {
    console.log("Got reply to step1");

    reply("step2", ["continue"], (client, eventName, args, reply) => {
        console.log("Got reply to step2");

        reply("step3", ["finish"]);
    });
});
```

## Reply Routing

When a reply arrives, the library checks if there's a registered `onReply` callback for the matching `eventId`. If there is:

1. The global `onMessage` callback is  called
2. The `onReply` callback is called
3. Per-event `client.on()` listeners are **not** called

If there is no matching `onReply` callback (either it was never registered, or it was already cleaned up), the message goes through the normal flow.

## Cleanup

To prevent memory leaks from replies that never arrive, the library automatically cleans up stale entries:

- A background check runs every **15 seconds**
- Any awaiting reply older than `clearAwaitingRepliesAfterMs` (default: **5 minutes**) is removed
- You can configure this timeout in the server options:

```typescript
const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    {
        port: 8080,
        clearAwaitingRepliesAfterMs: 30_000, // 30 seconds
    },
    callbacks,
);
```

When a stale reply is cleaned up and the reply eventually arrives, it will be processed through the normal `onMessage` and `client.on()` flow. You can use the `ids.replyTo` field to detect that it was meant to be a reply.

## Monitoring Awaiting Replies

You can check how many replies a client is waiting for:

```typescript
console.log(client.awaitingRepliesCount);
```

This can be useful for debugging or monitoring server health.
