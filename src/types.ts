import type { ServerOptions } from "ws";
import type { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import type { EZEZServerClient } from "./Client";

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
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

type Ids = {
    eventId: number;
    replyTo: number | null;
};

type ReplyTupleUnion<
    IncomingEvents extends TEvents, OutgoingEvents extends TEvents,
    Client extends EZEZServerClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: [
        client: Client, eventName: K, args: IncomingEvents[K], reply: Client["send"], ids: Ids,
    ]
}[keyof IncomingEvents];

type EventsToEventEmitter<
    IncomingEvents extends TEvents, OutgoingEvents extends TEvents,
    Client extends EZEZServerClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: (args: IncomingEvents[K], reply: Client["send"], ids: Ids) => void
};

type Callbacks<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = {
    /**
     * Called when the client is requesting authentication. Verify the auth string and return true if the client is
     * allowed to connect or false if the client should be rejected.
     * If your server does not require authentication, you should always return true.
     * @param client - The client that is requesting authentication
     * @param auth - The authentication string sent by the client
     */
    onAuthRequest: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>, auth: string) => Promise<boolean>;
    /**
     * Called when the client is authenticated successfully.
     * Use this to set up the client, e.g. send initial data or set up listeners.
     * @param client - The client that was authenticated
     */
    onAuthOk?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>) => void;
    /**
     * Called when the authentication for given client is rejected
     * @param client - The client that was rejected
     * @param reason - The reason for the rejection, can be used to display a message on the client's UI
     */
    onAuthRejected?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>, reason: string) => void;
    /**
     * Called when a message (any event) is received from the client.
     * Use @{link EZEZServerClient["on"]} to listen for specific events.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    onMessage?: <
        REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents,
            EZEZServerClient<IncomingEvents, OutgoingEvents>
        >,
    >(
        ...replyArgs: REvent
    ) => void;
};

type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
    [P in K]?: T[P] | undefined;
};

type AwaitingReply<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = {
    /**
     * Time when registered the need for a reply, used to clean up old listeners that never got the reply
     */
    time: number;
    eventId: number;
    /**
     * The callback that will be called when the reply is received.
     */
    onReply: NonNullable<Callbacks<IncomingEvents, OutgoingEvents>["onMessage"]>;
};

type EZEZServerOptions = ServerOptions & {
    /**
     * Port to listen on
     */
    port: number;
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

type ClientOptions = {
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
};

export {
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
