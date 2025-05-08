import { noop } from "@ezez/utils";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";

import type { TEvents } from "./types";

import { EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_AUTH } from "./types";

type Deps = {
    client: WebSocket;
    serialize: (...args: unknown[]) => Buffer;
    unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];
};

type Callbacks<Events extends TEvents> = {
    onClose: (client: EZEZServerClient<Events>) => void;
    onAuth: (auth: string) => Promise<boolean>;
    onMessage: <T extends keyof Events, R extends keyof Events>(
        // eslint-disable-next-line @typescript-eslint/no-shadow
        event: T,
        data: Events[T],
        eventId: number,
        reply: (eventName: R, ...args: Events[R]) => void,
    ) => void;
};

type Options = {
    messagesBeforeAuth: "ignore" | "queue" | "accept";
};

const AUTH_TIMEOUT = 5000;

let _clientCounter = 0;
const PROTOCOL_VERSION = 1;

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

    private readonly _callbacks: Callbacks<Events>;

    private readonly _options: Options;

    private _id = 0;

    private readonly _connectionId: number = _clientCounter++;

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    private readonly _queue: {
        [K in keyof Events]: [eventName: K, eventId: number, eventData: Events[K]];
    }[keyof Events][] = [];

    private readonly _awaitingReplies: any[] = [];

    public constructor(deps: Deps, callbacks: Callbacks<Events>, options: Options) {
        this._client = deps.client;
        this._serialize = deps.serialize;
        this._unserialize = deps.unserialize;
        this._callbacks = callbacks;
        this._options = options;

        // No need to stop this timeout, it won't do anything if auth succeeds
        setTimeout(this._checkAuthTimeout, AUTH_TIMEOUT);
        this._client.on("message", this._handleMessage);
        this._client.on("close", this._handleClose);
    }

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
                this._client.close();
                return;
            }

            this._callbacks.onAuth(authKey).then((isAuthOk) => {
                this._authOk = isAuthOk;

                if (!isAuthOk) {
                    this._client.send(this._serialize(EVENT_AUTH_REJECTED, "Invalid auth key"));
                    this._client.close();
                    return;
                }

                this._client.send(this._serialize(EVENT_AUTH_OK));
                this._queue.forEach(([qEventName, qEventId, qArgs]) => {
                    this._callbacks.onMessage(
                        qEventName, qArgs, qEventId,
                        <TEvent extends keyof Events>(replyEventName: TEvent, ...replyArgs: Events[TEvent]) => {
                            console.log("wanna reply?");
                            // this._client.send;
                        },
                    );
                });
                this._queue.length = 0;
            }).catch(noop);
            return;
        }

        if (!this._authOk && this._options.messagesBeforeAuth === "ignore") {
            return;
        }

        const eventName = data[0] as keyof Events;
        const [, eventId, ...args] = data as [keyof Events, number, ...Events[typeof eventName]];

        if (!this._authOk && this._options.messagesBeforeAuth === "queue") {
            this._queue.push([eventName, eventId, args]);
            return;
        }

        this._callbacks.onMessage(
            eventName, args, eventId,
            <TEvent extends keyof Events>(replyEventName: TEvent, ...replyArgs: Events[TEvent]) => {
                console.log("wanna reply?");
                // this._client.send;
            },
        );
    };

    public get alive() {
        return this._client.readyState === WebSocket.OPEN;
    }

    public send<TEvent extends keyof Events, REvent extends keyof Events>(
        eventName: TEvent, args: Events[TEvent], onReply?: (rEventName: REvent, ...rArgs: Events[REvent]) => void,
    ) {
        const client = this._client;
        if (!this.alive) {
            return;
        }

        client.send(this._serialize(eventName, ++this._id, ...args));

        // if (onReply) {
        //     this._awaitingReplies.push({
        //         time: Date.now(),
        //         eventName: eventName,
        //         eventId: this._id,
        //         onReply: onReply,
        //     });
        // }
    }

    private readonly _handleClose = () => {
        this._callbacks.onClose(this);
        this._queue.length = 0;
    };

    private readonly _checkAuthTimeout = () => {
        if (!this._authSent) {
            this._client.send(this._serialize(EVENT_AUTH_REJECTED, "Auth timeout"));
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
