import { WebSocketServer } from "ws";
import { ensureError, omit, pull, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";

import type { Callbacks, ClientOptions, EZEZServerOptions, TEvents } from "./types";

import { EZEZServerClient } from "./Client";

type Options = EZEZServerOptions & ClientOptions;

const defaultOptions: Required<ClientOptions> = {
    messagesBeforeAuth: "ignore",
    sendAfterDisconnect: "ignore",
};

class EZEZWebsocketServer<Events extends TEvents> {
    private readonly _options: EZEZServerOptions & Required<ClientOptions>;

    private readonly _callbacks: Callbacks<Events>;

    private _wss: WebSocketServer | null = null;

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
            try {
                const wss = new WebSocketServer(omit(this._options, [
                    "serializerArgs", "unserializerArgs", "messagesBeforeAuth", "sendAfterDisconnect",
                ]));
                this._wss = wss;

                let fulfilled = false;

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
                            sendAfterDisconnect: this._options.sendAfterDisconnect,
                        }),
                    );
                });

                wss.once("listening", () => {
                    if (fulfilled) {
                        throw new Error("Unexpected `listening` event after `error`");
                    }
                    resolve();
                    fulfilled = true;
                });

                wss.once("error", (e) => {
                    if (fulfilled) {
                        throw new Error("Unexpected `error` event after `listening`");
                    }
                    reject(e);
                    fulfilled = true;
                });
            }
            catch (e) {
                reject(ensureError(e));
            }
        });
    }

    /**
     * Broadcast a message to all clients
     * @param eventName
     * @param args
     */
    public broadcast<T extends keyof Events>(eventName: T, args: Events[T]) {
        this._clients.forEach((client) => {
            client.send(eventName, args);
        });
    }

    /**
     * Gets the list of connected clients
     */
    public get clients() {
        return [...this._clients];
    }

    /**
     * Gets the raw WebSocketServer instance
     * Warning: sending messages manually will probably result in crashes due to unexpected message format
     */
    public get wss() {
        return this._wss;
    }

    /**
     * Stops the server
     */
    public close() {
        if (this._wss) {
            this._wss.close();
            this._wss = null;
            this._clients.length = 0;
        }
    }
}

export { EZEZWebsocketServer };
