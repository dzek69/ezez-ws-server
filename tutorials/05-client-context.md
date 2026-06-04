# Per-Client Context

Real WebSocket servers usually need to attach state to each connection — who is the authenticated user, what channels they joined, how many requests they've made, etc.

The library gives you a typed, per-client `context` bag that you can read and write freely from any callback.

## Defining the Context Shape

`EZEZWebsocketServer` takes a third generic parameter, `TContext`. When you specify it, you must also provide a `defaultContext` in the options — the server uses it as the initial value for every new client (via `structuredClone`, so each client gets an independent copy).

```typescript
type IncomingEvents = {
    sendMessage: [text: string, channel: string];
    joinChannel: [channel: string];
};

type OutgoingEvents = {
    newMessage: [sender: string, text: string, channel: string];
};

type ClientContext = {
    userId: number | null;
    nickname: string;
    channels: string[];
    messagesSent: number;
};

const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents, ClientContext>(
    {
        port: 8080,
        defaultContext: {
            userId: null,
            nickname: "anonymous",
            channels: [],
            messagesSent: 0,
        },
    },
    {
        onAuthRequest: async (client, authKey) => {
            const user = await lookupUser(authKey);
            if (!user) return false;

            client.context.userId = user.id;
            client.context.nickname = user.nickname;
            return true;
        },
    },
);
```

## Reading and Writing

`client.context` is a plain mutable object — read and write its properties anywhere you have access to the client.

```typescript
onAuthOk: (client) => {
    console.log(`${client.context.nickname} (#${client.context.userId}) connected`);

    client.on("joinChannel", (args) => {
        const [channel] = args;
        client.context.channels.push(channel);
    });

    client.on("sendMessage", (args) => {
        const [text, channel] = args;
        if (!client.context.channels.includes(channel)) return;
        client.context.messagesSent++;
        broadcastToChannel(channel, client.context.nickname, text);
    });
},

onDisconnect: (client) => {
    console.log(
        `${client.context.nickname} disconnected after sending ${client.context.messagesSent} messages`,
    );
},
```

## Isolation Between Clients

The `defaultContext` you provide is **cloned** for every new connection using `structuredClone`. That means nested objects, arrays, `Date`s, `Map`s, etc. are deep-copied — mutating one client's context never leaks into another's.

```typescript
defaultContext: {
    channels: ["lobby"], // every client starts with their own ["lobby"] array
}

// later, in onAuthOk:
client.context.channels.push("vip"); // only this client's array changes
```

> Note: `structuredClone` doesn't copy functions, class instances with custom prototypes, or DOM-style objects. If you need those, initialize them inside `onAuthRequest` / `onAuthOk` rather than putting them in `defaultContext`.

## Without the Generic

If you don't specify `TContext`, it defaults to `Record<string, never>` — an empty bag. `defaultContext` becomes optional and `client.context` exists but you can't read or write anything meaningful on it. This keeps the feature zero-cost when you don't need it.

```typescript
const server = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(
    { port: 8080 }, // no defaultContext needed
    { onAuthRequest: async () => true },
);
```

## Type Safety

Because `TContext` propagates everywhere, every callback that receives a client (and every `client.on()` listener) sees the fully-typed `client.context`. TypeScript will catch typos and shape mismatches at compile time:

```typescript
client.context.nicknam = "alice"; // ❌ Property 'nicknam' does not exist
client.context.messagesSent = "five"; // ❌ Type 'string' is not assignable to 'number'
```
