import type { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import type { ServerOptions } from "ws";
import type { EZEZServerClient } from "./Client";

/** @internal Prefix reserved for internal protocol event names. */
const RESERVED_PREFIX = "ezez-ws::";
/** @internal Event name used for authentication requests. */
const EVENT_AUTH = "ezez-ws::auth";
/** @internal Event name used to confirm successful authentication. */
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
/** @internal Event name used to reject authentication. */
const EVENT_AUTH_REJECTED = "ezez-ws::auth-rejected";

type ReservedNames = `ezez-ws::${string}`;
type ReservedEventKeys<T extends string> = {
    [K in T]?: never;
};

/**
 * Generic type representing all events with the data that will come with them.
 * @example
 * ```typescript
 * type IncomingEvents = {
 *     addItem: [item: string, quantity: number],
 *     removeItem: [item: string],
 * }
 * ```
 */
type TEvents = Record<string, unknown[]> & ReservedEventKeys<ReservedNames>;

/**
 * Identifies a message in the protocol. Passed to message handlers and returned from `send()`.
 *
 * @property eventId - Unique ID assigned to this message by the sender.
 * @property replyTo - The `eventId` of the message this is replying to, or `null` if not a reply.
 */
type Ids = {
    eventId: number;
    replyTo: number | null;
};

/**
 * Union type representing all possible shapes of a reply handler's arguments.
 *
 * For each event in `IncomingEvents`, produces a tuple of
 * `[client, eventName, args, reply, ids]`. The union of all these tuples is used to type
 * the `onMessage` and `onReply` callback parameters.
 *
 * @internal This is primarily used for internal typing of callback signatures.
 */
type ReplyTupleUnion<
    IncomingEvents extends TEvents,
    Client extends { send: unknown },
> = {
    [K in keyof IncomingEvents]: [
        client: Client, eventName: K, args: IncomingEvents[K], reply: Client["send"], ids: Ids,
    ]
}[keyof IncomingEvents];

/**
 * Maps event names to their EventEmitter listener signatures.
 *
 * For each event in `IncomingEvents`, produces a listener function type
 * `(args, reply, ids) => void` that is used with {@link EZEZServerClient.on},
 * {@link EZEZServerClient.off}, and {@link EZEZServerClient.once}.
 *
 * @internal This is primarily used for internal typing of the EventEmitter.
 */
type EventsToEventEmitter<
    IncomingEvents extends TEvents,
    Client extends { send: unknown },
> = {
    [K in keyof IncomingEvents]: (args: IncomingEvents[K], reply: Client["send"], ids: Ids) => void
};

/**
 * Lifecycle callbacks for the WebSocket server.
 *
 * Only `onAuthRequest` is required. All other callbacks are optional.
 *
 * The library expects your callbacks not to throw (and async ones not to reject) - they are invoked without
 * any protective try/catch, so an exception escaping a callback is your bug to fix, and depending on the
 * context it may end up as an unhandled error or rejection.
 * The only exception is `onAuthRequest`: since rejecting a client based on external checks (database down,
 * verification service error) is a legitimate outcome, its throw/rejection is treated as an auth failure -
 * the error is reported via `onError` and the client is rejected and disconnected.
 */
type Callbacks<
    IncomingEvents extends TEvents,
    OutgoingEvents extends TEvents = IncomingEvents,
    TContext extends object = Record<string, never>,
> = {
    /**
     * Called when the client is requesting authentication. Verify the auth string and return true if the client is
     * allowed to connect or false if the client should be rejected.
     * If your server does not require authentication, you should always return true.
     * @param client - The client that is requesting authentication
     * @param auth - The authentication string sent by the client
     */
    onAuthRequest: (
        client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>, auth: string,
    ) => Promise<boolean>;
    /**
     * Called when the client is authenticated successfully.
     * Use this to set up the client, e.g. send initial data or set up listeners.
     * @param client - The client that was authenticated
     */
    onAuthOk?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>) => void;
    /**
     * Called when the authentication for given client is rejected
     * @param client - The client that was rejected
     * @param reason - The reason for the rejection, can be used to display a message on the client's UI
     */
    onAuthRejected?: (
        client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>, reason: string,
    ) => void;
    /**
     * Called when a message (any event) is received from the client.
     * Use {@link EZEZServerClient.on} to listen for specific events.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    onMessage?: <
        REvent extends ReplyTupleUnion<
            IncomingEvents,
            EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>
        >,
    >(
        ...replyArgs: REvent
    ) => void;
    /**
     * Called when the client disconnects from the server.
     * @param client - The client that disconnected
     * @param code - The close code sent by the client
     * @param reason - The close reason sent by the client
     */
    onDisconnect?: (
        client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>, code: number, reason: string,
    ) => void;
    /**
     * Called when an error occurs on the client connection.
     * @param client - The client that encountered an error
     * @param error - The error that occurred
     */
    onError?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>, error: Error) => void;
};

/**
 * Utility type that makes specified keys optional while keeping others unchanged.
 * @internal
 */
type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
    [P in K]?: T[P] | undefined;
};

/**
 * Internal structure for tracking a sent message that is waiting for a reply.
 * @internal
 */
type AwaitingReply<
    IncomingEvents extends TEvents,
    OutgoingEvents extends TEvents = IncomingEvents,
    TContext extends object = Record<string, never>,
> = {
    /**
     * Time when registered the need for a reply, used to clean up old listeners that never got the reply
     */
    time: number;
    eventId: number;
    /**
     * The callback that will be called when the reply is received.
     */
    onReply: NonNullable<Callbacks<IncomingEvents, OutgoingEvents, TContext>["onMessage"]>;
};

/**
 * Server-level options extending the native `ws` `ServerOptions`.
 *
 * Includes all options from the `ws` library (such as `port`, `server`, `noServer`, `path`, etc.)
 * plus optional custom serialization configuration.
 *
 * Note: the `ws` option `maxPayload` (maximum size of a single incoming message) is defaulted by this
 * library to 1 MiB instead of `ws`'s own 100 MiB. A message exceeding it always closes the connection
 * (close code 1009) - `ws` enforces the limit while the frame is still being received, so oversized frames
 * are never fully buffered in memory.
 */
type EZEZServerOptions = ServerOptions & {
    /**
     * Custom data serializer options, see `@ezez/utils - serializeToBuffer`
     * Your custom serializer must be compatible with custom deserializer on the client side
     */
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    /**
     * Custom data unserializer options, see `@ezez/utils - unserializeFromBuffer`
     * Your custom unserializer must be compatible with custom serializer on the client side
     */
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
};

/**
 * Options controlling per-client behavior regarding authentication, disconnection, and reply tracking.
 *
 * All fields are optional and have sensible defaults.
 */
type ClientOptions<
    IncomingEvents extends TEvents = TEvents,
    OutgoingEvents extends TEvents = IncomingEvents,
    TContext extends object = Record<string, never>,
> = {
    /**
     * How to handle messages before authentication
     * - "ignore": ignore the message
     * - "queue": queue the message until authentication
     * - "accept": accept the message (it's your responsibility to properly handle each message type)
     */
    messagesBeforeAuth?: "ignore" | "queue" | "accept";
    /**
     * How to handle messages that servers tries to send after disconnection
     * - "ignore": ignore the message
     * - "throw": throw an error
     */
    sendAfterDisconnect?: "ignore" | "throw";
    /**
     * The number of milliseconds a client has to send its auth message before the connection is rejected
     * and closed. This rejects bare WebSocket connections that never even attempt to authenticate
     * (e.g. random internet bots). It does not limit how long the `onAuthRequest` verification itself takes.
     * It must be greater than 0, by default it is set to 5 seconds.
     */
    authTimeoutMs?: number;
    /**
     * The maximum total size (in bytes) of messages queued before authentication completes
     * (only relevant with `messagesBeforeAuth: "queue"`). What happens with a message that would not fit
     * is controlled by `queueOverflow`.
     * It must be greater than 0, by default it is set to 1 MiB.
     */
    queueLimitBytes?: number;
    /**
     * What to do when a pre-auth message would push the queue over `queueLimitBytes`
     * (only relevant with `messagesBeforeAuth: "queue"`):
     * - "ignore" (default): silently drop the message; the connection and already queued messages are kept
     * - "disconnect": close the connection (close code 1008)
     * - callback: the message is dropped and your callback is called with the client and the byte length
     *   of the dropped message - e.g. to send back an error or to disconnect; the connection stays open
     *
     * This only concerns the queue - the size of a single message is limited by the native `ws` `maxPayload`
     * option (which this library defaults to 1 MiB instead of `ws`'s own 100 MiB), and exceeding that always
     * closes the connection (close code 1009).
     */
    queueOverflow?: "ignore" | "disconnect"
        | ((client: EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>, byteLength: number) => void);
    /**
     * The number of milliseconds after which the client will clear the awaiting replies.
     * This prevents memory leaks in case the client is waiting for a reply that will never come.
     * It must be greater than 0, by default it is set to 5 minutes.
     *
     * If clearing occurs and then the awaited reply arrives, it will still be emitted and caught by the `onMessage` and
     * `on(eventName)` listeners. Use the `ids` parameter to check if something was meant to be a reply if that's
     * important.
     *
     * The check occurs every 15 seconds, so the actual clearing time may be longer than specified.
     */
    clearAwaitingRepliesAfterMs?: number;
};

export {
    RESERVED_PREFIX,
    EVENT_AUTH,
    EVENT_AUTH_OK,
    EVENT_AUTH_REJECTED,
};

export type {
    TEvents,
    ReplyTupleUnion,
    Callbacks,
    MakeOptional,
    Ids,
    EventsToEventEmitter,
    AwaitingReply,
    EZEZServerOptions,
    ClientOptions,
};
