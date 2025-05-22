import { WebSocketServer } from "ws";
import { pull, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";

import type { Callbacks, TEvents } from "./types";

import { EZEZServerClient } from "./Client";

// TODO extend WebSocketServer
type Options = {
    port: number;
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
    messagesBeforeAuth?: "ignore" | "queue" | "accept";
};

const defaultOptions: Required<Pick<Options, "messagesBeforeAuth">> = {
    messagesBeforeAuth: "ignore",
};

class EZEZWebsocketServer<Events extends TEvents> {
    private readonly _options: Options & { messagesBeforeAuth: "ignore" | "queue" | "accept" };

    private readonly _callbacks: Callbacks<Events>;

    private _socket: WebSocketServer | null = null;

    private readonly _clients: EZEZServerClient<Events>[] = [];

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    public constructor(options: Options, callbacks: Callbacks<Events>) {
        this._options = { ...defaultOptions, ...options };
        this._callbacks = callbacks;

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);
    }

    public start() {
        return new Promise<void>((resolve, reject) => {
            const wss = new WebSocketServer({ port: this._options.port });
            this._socket = wss;

            wss.on("connection", (client) => {
                this._clients.push(
                    new EZEZServerClient<Events>({
                        client: client,
                        serialize: this._serialize,
                        unserialize: this._unserialize,
                    }, {
                        onClose: (cl) => {
                            pull(this._clients, cl);
                        },
                        onAuthRequest: this._callbacks.onAuthRequest,
                        onAuthOk: this._callbacks.onAuthOk,
                        onAuthRejected: this._callbacks.onAuthRejected,
                        onMessage: this._callbacks.onMessage,
                    }, {
                        messagesBeforeAuth: this._options.messagesBeforeAuth,
                    }),
                );
            });

            wss.once("listening", () => {
                resolve();
            });

            wss.once("error", (e) => {
                // TODO remove after testing
                console.error("WSS error", e);
                reject(e);
            });
        });
    }

    public broadcast<T extends keyof Events>(eventName: T, args: Events[T]) {
        this._clients.forEach((client) => {
            client.send(eventName, args);
        });
    }

    public get clients() {
        return this._clients;
    }

    public get socket() {
        return this._socket;
    }

    public stop() {
        if (this._socket) {
            this._socket.close();
            this._socket = null;
        }
    }
}

export { EZEZWebsocketServer };
