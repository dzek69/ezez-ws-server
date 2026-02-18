/* eslint-disable max-lines */

import { noop } from "@ezez/utils";
import EventEmitter from "eventemitter3";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";

import type { EZEZWebsocketServer } from "./index";
import type {
    AwaitingReply,
    Callbacks, ClientOptions, EventsToEventEmitter, Ids,
    MakeOptional, ReplyTupleUnion, TEvents,
} from "./types";

import { EVENT_AUTH, EVENT_AUTH_OK, EVENT_AUTH_REJECTED } from "./types";

type Deps = {
    client: WebSocket;
    serialize: (...args: unknown[]) => Buffer;
    unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];
};

type ClientCallbacks<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = MakeOptional<
    Callbacks<IncomingEvents, OutgoingEvents>, "onAuthOk" | "onAuthRejected" | "onMessage" | "onDisconnect" | "onError"
> & { onClose: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>) => void };

const AUTH_TIMEOUT = 5_000;
const AWAITING_REPLIES_INTERVAL = 15_000;
let _clientCounter = 0;
const PROTOCOL_VERSION = 1;
const NOT_FOUND = -1;

/**
 * Represents an individual client connected to the WebSocket server.
 *
 * Each instance manages:
 * - Per-client authentication state and timeout
 * - Type-safe event listeners via {@link on}, {@link off}, and {@link once}
 * - Message sending with optional reply tracking via {@link send}
 * - Automatic cleanup of stale reply listeners
 *
 * Instances are created automatically by {@link EZEZWebsocketServer} when a client connects
 * and are passed to your callbacks (e.g., `onAuthRequest`, `onAuthOk`, `onMessage`).
 *
 * @template IncomingEvents - Map of event names to argument tuples that this client can send to the server.
 * @template OutgoingEvents - Map of event names to argument tuples that the server can send to this client.
 *   Defaults to `IncomingEvents` if not specified.
 */
class EZEZServerClient<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> {
    private readonly _client: WebSocket;

    /**
     * Did the client send an auth message (this does not indicate the auth success)
     */
    private _authSent: boolean = false;

    /**
     * Did the client auth successfully
     */
    private _authOk: boolean = false;

    private readonly _callbacks: ClientCallbacks<IncomingEvents, OutgoingEvents>;

    private readonly _options: Required<ClientOptions>;

    private _id = 0;

    private readonly _connectionId: number = _clientCounter++;

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    /**
     * Queue of raw messages that were sent before the auth was successful.
     */
    private readonly _queue: Buffer[] = [];

    /**
     * List of sent messages that are waiting for a reply.
     */
    private readonly _awaitingReplies: Array<AwaitingReply<IncomingEvents, OutgoingEvents>> = [];

    /**
     * Sends a message to the client.
     *
     * If the client is disconnected, behavior depends on the `sendAfterDisconnect` option:
     * - `"ignore"` (default): silently returns `undefined`
     * - `"throw"`: throws an error
     *
     * @param eventName - The name of the event to send.
     * @param args - The arguments to send with the event.
     * @param onReply - Optional callback invoked when the client replies to this specific message.
     *   When a reply arrives and this callback is registered, the reply bypasses any per-event `on()` listeners.
     * @returns The message `Ids` (containing `eventId` and `replyTo`), or `undefined` if the message was not sent.
     */
    public send: <TEvent extends keyof OutgoingEvents>(
        eventName: TEvent,
        args: OutgoingEvents[TEvent],
        onReply?: <REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents,
            EZEZServerClient<IncomingEvents, OutgoingEvents>
        >>(...replyArgs: REvent) => void,
    ) => Ids | undefined;

    private readonly _ee: EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZServerClient<IncomingEvents, OutgoingEvents>
    >>;

    /**
     * Registers an event listener for given event.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    public readonly on: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZServerClient<IncomingEvents, OutgoingEvents>
    >>["on"]>;

    /**
     * Unregisters an event listener for given event.
     */
    public readonly off: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZServerClient<IncomingEvents, OutgoingEvents>
    >>["off"]>;

    /**
     * Registers an event listener for given event, which will be called only once.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    public readonly once: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZServerClient<IncomingEvents, OutgoingEvents>
    >>["once"]>;

    private readonly _authTimeoutId: ReturnType<typeof setTimeout>;

    private readonly _awaitingRepliesIntervalId: ReturnType<typeof setInterval>;

    public constructor(
        deps: Deps, callbacks: ClientCallbacks<IncomingEvents, OutgoingEvents>, options: Required<ClientOptions>,
    ) {
        this._client = deps.client;
        this._serialize = deps.serialize;
        this._unserialize = deps.unserialize;
        this._callbacks = callbacks;
        this._options = options;
        this._ee = new EventEmitter();
        this.on = this._ee.on.bind(this._ee);
        this.off = this._ee.off.bind(this._ee);
        this.once = this._ee.once.bind(this._ee);

        this._authTimeoutId = setTimeout(this._checkAuthTimeout, AUTH_TIMEOUT);
        this._awaitingRepliesIntervalId = setInterval(this._checkAwaitingReplies, AWAITING_REPLIES_INTERVAL);
        this._client.on("message", this._handleMessage);
        this._client.on("close", this._handleClose);
        this._client.on("error", this._handleError);

        this.send = (eventName, args, onReply) => {
            return this._send(eventName, args, null, onReply);
        };
    }

    // eslint-disable-next-line max-lines-per-function
    private readonly _handleMessage = (message: Buffer | string) => { // eslint-disable-line max-statements
        if (!(message instanceof Buffer)) {
            // Whatever this is, it's officially not supported
            return;
        }
        const data = this._unserialize(message);
        if (data[0] === EVENT_AUTH) {
            const [, authKey, protocolVersion] = data as [string, string, number];
            this._authSent = true;

            if (protocolVersion !== PROTOCOL_VERSION) {
                this._authOk = false;
                const reason = `Protocol version mismatch, wanted ${PROTOCOL_VERSION}, got ${protocolVersion}`;
                this._client.send(this._serialize(EVENT_AUTH_REJECTED, reason));
                this._callbacks.onAuthRejected?.(this, reason);
                this._client.close();
                return;
            }

            this._callbacks.onAuthRequest(this, authKey).then((isAuthOk) => {
                clearTimeout(this._authTimeoutId);
                this._authOk = isAuthOk;

                if (!isAuthOk) {
                    const reason = "Invalid auth key";
                    this._client.send(this._serialize(EVENT_AUTH_REJECTED, reason));
                    this._callbacks.onAuthRejected?.(this, reason);
                    this._client.close();
                    return;
                }

                this._client.send(this._serialize(EVENT_AUTH_OK));
                this._callbacks.onAuthOk?.(this);
                this._queue.forEach(this._handleMessage);
                this._queue.length = 0;
            }).catch(noop); // TODO this noop should be handled properly, in case onAuthRejected crashes for example
            return;
        }

        if (!this._authOk && this._options.messagesBeforeAuth === "ignore") {
            return;
        }

        const eventName = data[0] as keyof IncomingEvents;
        const [, eventId, replyTo, ...args] = data as [
            keyof IncomingEvents, number, number | null, ...IncomingEvents[typeof eventName],
        ];

        if (!this._authOk && this._options.messagesBeforeAuth === "queue") {
            this._queue.push(message);
            return;
        }

        type ReplyFn = Parameters<NonNullable<Callbacks<IncomingEvents, OutgoingEvents>["onMessage"]>>[3];
        const replyFn: ReplyFn = (_eventName, _args, onReply) => this._send(_eventName, _args, eventId, onReply);

        if (replyTo) {
            const replyIdx = this._awaitingReplies.findIndex((reply) => reply.eventId === replyTo);
            if (replyIdx !== NOT_FOUND) {
                const reply = this._awaitingReplies[replyIdx]!;
                this._awaitingReplies.splice(replyIdx, 1);
                this._callbacks.onMessage?.(this, eventName, args, replyFn, { eventId, replyTo });
                reply.onReply(this, eventName, args, replyFn, { eventId, replyTo });
                return;
            }
        }

        this._callbacks.onMessage?.(this, eventName, args, replyFn, { eventId, replyTo });
        // @ts-expect-error not sure why emit does not like the type, `on` works flawlessly
        this._ee.emit(eventName, args, replyFn, { eventId, replyTo });
    };

    /**
     * Whether the client's WebSocket connection is currently open and ready to send/receive messages.
     */
    public get alive() {
        return this._client.readyState === WebSocket.OPEN;
    }

    /**
     * Disconnects the client from the server.
     * @param code - Optional close code (default: 1000 - normal closure)
     * @param reason - Optional close reason string
     */
    public disconnect(code?: number, reason?: string) {
        this._client.close(code, reason);
    }

    private _send<TEvent extends keyof OutgoingEvents>(
        eventName: TEvent, args: OutgoingEvents[TEvent], replyId: number | null = null,
        onReply?: <REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents, EZEZServerClient<IncomingEvents, OutgoingEvents>
        >>(
            ...replyArgs: REvent
        ) => void,
    ): Ids | undefined {
        const client = this._client;
        if (!this.alive) {
            if (this._options.sendAfterDisconnect === "throw") {
                throw new Error("Can't send message - client is disconnected");
            }
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const _args = args ? args : [];
        client.send(this._serialize(eventName, ++this._id, replyId, ..._args));

        if (onReply) {
            this._awaitingReplies.push({
                time: Date.now(),
                eventId: this._id,
                onReply,
            });
        }

        return { eventId: this._id, replyTo: replyId };
    }

    private readonly _handleClose = (code: number, reason: Buffer) => {
        clearTimeout(this._authTimeoutId);
        clearInterval(this._awaitingRepliesIntervalId);
        this._callbacks.onDisconnect?.(this, code, reason.toString());
        this._callbacks.onClose(this);
        this._queue.length = 0;
        this._awaitingReplies.length = 0;
        this._ee.removeAllListeners();
    };

    private readonly _handleError = (error: Error) => {
        this._callbacks.onError?.(this, error);
    };

    private readonly _checkAuthTimeout = () => {
        if (!this._authSent) {
            const reason = "Auth timeout";
            this._client.send(this._serialize(EVENT_AUTH_REJECTED, reason));
            this._callbacks.onAuthRejected?.(this, reason);
            this._client.close();
        }
    };

    private readonly _checkAwaitingReplies = () => {
        const now = Date.now();
        for (let i = this._awaitingReplies.length - 1; i >= 0; i--) {
            const reply = this._awaitingReplies[i];
            if (now - reply!.time > this._options.clearAwaitingRepliesAfterMs) {
                this._awaitingReplies.splice(i, 1);
            }
        }
    };

    /**
     * Unique numeric identifier for this connection, auto-incremented starting from 0
     * across the lifetime of the server process.
     *
     * Useful for logging or tracking individual clients. Note that this counter is global
     * and does not reset when the server restarts within the same process.
     */
    public get connectionId(): number {
        return this._connectionId;
    }

    /**
     * Gets the count of messages that are waiting for a reply.
     */
    public get awaitingRepliesCount(): number {
        return this._awaitingReplies.length;
    }

    /**
     * The underlying `ws` WebSocket instance for this connection.
     *
     * @remarks
     * Sending messages directly through this instance will bypass the library's serialization protocol
     * and will likely cause parsing errors on the receiving end. Use {@link send} instead.
     */
    public get client() {
        return this._client;
    }
}

type InferInOut<X extends EZEZWebsocketServer<any, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
    = X extends EZEZWebsocketServer<infer In, infer Out> ? [In, Out] : never;

/**
 * Utility type for typing event handler callbacks that can be defined outside of inline `client.on()` calls.
 *
 * @template Srv - The server type (use `typeof yourServerInstance`)
 * @template Ev - The event name (must be a key of IncomingEvents)
 *
 * @example
 * ```typescript
 * const ws = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>(...);
 *
 * const ping2Handler: OnCallback<typeof ws, "ping2"> = (args, reply, ids) => {
 *   // args, reply, etc. are typed
 * };
 *
 * client.on("ping2", ping2Handler);
 * ```
 */
type OnCallback<
    Srv extends EZEZWebsocketServer<any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    Ev extends keyof InferInOut<Srv>[0],
> = EventsToEventEmitter<
    InferInOut<Srv>[0],
    InferInOut<Srv>[1],
    EZEZServerClient<InferInOut<Srv>[0], InferInOut<Srv>[1]>
>[Ev];

export {
    EZEZServerClient,
};

export type {
    OnCallback,
};
