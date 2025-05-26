/* eslint-disable max-lines */

import { noop } from "@ezez/utils";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";
import EventEmitter from "eventemitter3";

import type {
    Callbacks, ClientOptions, AwaitingReply,
    EventsToEventEmitter, ReplyTupleUnion, Ids,
    MakeOptional, TEvents,
} from "./types";

import { EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_AUTH } from "./types";

type Deps = {
    client: WebSocket;
    serialize: (...args: unknown[]) => Buffer;
    unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];
};

type ClientCallbacks<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = MakeOptional<
    Callbacks<IncomingEvents, OutgoingEvents>, "onAuthOk" | "onAuthRejected" | "onMessage"
> & { onClose: (client: EZEZServerClient<IncomingEvents, OutgoingEvents>) => void };

const AUTH_TIMEOUT = 5_000;
const AWAITING_REPLIES_INTERVAL = 15_000;
let _clientCounter = 0;
const PROTOCOL_VERSION = 1;
const NOT_FOUND = -1;

/**
 * Class representing a client connected to the server.
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
    private readonly _awaitingReplies: AwaitingReply<IncomingEvents, OutgoingEvents>[] = [];

    /**
     * Sends a message to the client.
     * @param eventName - The name of the event to send.
     * @param args - The arguments to send with the event.
     * @param onReply - Optional callback to be called when a reply to this specific message is received.
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
                reply.onReply(this, eventName, args, replyFn, { eventId, replyTo });
                return;
            }
        }

        this._callbacks.onMessage?.(this, eventName, args, replyFn, { eventId, replyTo });
        // @ts-expect-error not sure why emit does not like the type, `on` works flawlessly
        this._ee.emit(eventName, args, replyFn, { eventId, replyTo });
    };

    /**
     * Gets whether the client is currently connected and ready.
     */
    public get alive() {
        return this._client.readyState === WebSocket.OPEN;
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
                onReply: onReply,
            });
        }

        return { eventId: this._id, replyTo: replyId };
    }

    private readonly _handleClose = () => {
        clearTimeout(this._authTimeoutId);
        clearInterval(this._awaitingRepliesIntervalId);
        this._callbacks.onClose(this);
        this._queue.length = 0;
        this._awaitingReplies.length = 0;
        this._ee.removeAllListeners();
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
     * Gets the connection ID of the client, which is a counter that is incremented for each new client,
     * starting from 0.
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
}

export {
    EZEZServerClient,
};
