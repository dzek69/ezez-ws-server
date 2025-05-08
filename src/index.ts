import { WebSocketServer } from "ws";
import { pull, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";

import type { TEvents } from "./types";

import { EZEZServerClient } from "./Client";

// TODO extend WebSocketServer
type Options = {
    port: number;
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
};

type Callbacks = {
    onAuth: (auth: string) => Promise<boolean>;
    onMessage: () => void;
};

class EZEZWebsocketServer<Events extends TEvents> {
    private readonly _options: Options;

    private readonly _callbacks: Callbacks;

    private socket: WebSocketServer | null = null;

    private readonly _clients: EZEZServerClient<Events>[] = [];

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    public constructor(options: Options, callbacks: Callbacks) {
        this._options = options;
        this._callbacks = callbacks;

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);
    }

    public start() {
        return new Promise<void>((resolve, reject) => {
            const wss = new WebSocketServer({ port: this._options.port });
            this.socket = wss;

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
                        onAuth: this._callbacks.onAuth,
                        onMessage: this._callbacks.onMessage,
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
}

export { EZEZWebsocketServer };
