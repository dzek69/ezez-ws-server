import { noop } from "@ezez/utils";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";

import type { AwaitingReply, Callbacks, ClientOptions, Ids, MakeOptional, ReplyTupleUnion, TEvents } from "./types";

import { EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_AUTH } from "./types";

type Deps = {
    client: WebSocket;
    serialize: (...args: unknown[]) => Buffer;
    unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];
};

type ClientCallbacks<Events extends TEvents> = MakeOptional<
    Callbacks<Events>, "onAuthOk" | "onAuthRejected" | "onMessage"
> & {
    onClose: (client: EZEZServerClient<Events>) => void;
};

const AUTH_TIMEOUT = 5000;

let _clientCounter = 0;
const PROTOCOL_VERSION = 1;
const NOT_FOUND = -1;

/**
 * Class representing a client connected to the server.
 */
class EZEZServerClient<Events extends TEvents> {
    private readonly _client: WebSocket;

    /**
     * Did the client send an auth message (this does not indicate the auth success)
     */
    private _authSent: boolean = false;

    /**
     * Did the client auth successfully
     */
    private _authOk: boolean = false;

    private readonly _callbacks: ClientCallbacks<Events>;

    private readonly _options: Required<ClientOptions>;

    private _id = 0;

    private readonly _connectionId: number = _clientCounter++;

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    private readonly _queue: Buffer[] = [];

    private readonly _awaitingReplies: AwaitingReply<Events>[] = [];

    public send: <TEvent extends keyof Events>(
        eventName: TEvent,
        args: Events[TEvent],
        onReply?: <REvent extends ReplyTupleUnion<Events, typeof this.send>>(
            ...replyArgs: REvent
        ) => void,
    ) => Ids | undefined;

    public constructor(deps: Deps, callbacks: ClientCallbacks<Events>, options: Required<ClientOptions>) {
        this._client = deps.client;
        this._serialize = deps.serialize;
        this._unserialize = deps.unserialize;
        this._callbacks = callbacks;
        this._options = options;

        // No need to stop this timeout, it won't do anything if auth succeeds
        setTimeout(this._checkAuthTimeout, AUTH_TIMEOUT);
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
                this._queue.forEach(msg => {
                    this._handleMessage(msg);
                });
                this._queue.length = 0;
            }).catch(noop);
            return;
        }

        if (!this._authOk && this._options.messagesBeforeAuth === "ignore") {
            return;
        }

        const eventName = data[0] as keyof Events;
        const [, eventId, replyTo, ...args] = data as [
            keyof Events, number, number | null, ...Events[typeof eventName],
        ];

        if (!this._authOk && this._options.messagesBeforeAuth === "queue") {
            this._queue.push(message);
            return;
        }

        type ReplyFn = Parameters<NonNullable<Callbacks<Events>["onMessage"]>>[2];
        const replyFn: ReplyFn = (_eventName, _args, onReply) => this._send(_eventName, _args, eventId, onReply);

        if (replyTo) {
            const replyIdx = this._awaitingReplies.findIndex((reply) => reply.eventId === replyTo);
            if (replyIdx !== NOT_FOUND) {
                const reply = this._awaitingReplies[replyIdx]!;
                this._awaitingReplies.splice(replyIdx, 1);
                reply.onReply(eventName, args, replyFn, { eventId, replyTo });
                return;
            }
        }

        this._callbacks.onMessage?.(eventName, args, replyFn, { eventId, replyTo });
    };

    public get alive() {
        return this._client.readyState === WebSocket.OPEN;
    }

    private _send<TEvent extends keyof Events>(
        eventName: TEvent, args: Events[TEvent], replyId: number | null = null,
        onReply?: <REvent extends ReplyTupleUnion<Events, typeof this.send>>(
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
        this._callbacks.onClose(this);
        this._queue.length = 0;
    };

    private readonly _checkAuthTimeout = () => {
        if (!this._authSent) {
            const reason = "Auth timeout";
            this._client.send(this._serialize(EVENT_AUTH_REJECTED, reason));
            this._callbacks.onAuthRejected?.(this, reason);
            this._client.close();
        }
    };

    public get connectionId(): number {
        return this._connectionId;
    }
}

export {
    EZEZServerClient,
};
