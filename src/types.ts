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

type Callbacks<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = {
    onAuthRequest: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>, auth: string) => Promise<boolean>;
    onAuthOk?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>) => void;
    onAuthRejected?: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>, reason: string) => void;
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
    AwaitingReply,
    EZEZServerOptions,
    ClientOptions,
};
