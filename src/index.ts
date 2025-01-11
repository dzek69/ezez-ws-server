import { WebSocketServer } from "ws";
import { pull } from "@ezez/utils";

import { EZEZServerClient } from "./Client";

// TODO extend WebSocketServer
type Options = {
    port: number;
};

type Deps = {
    onAuth: (auth: string) => Promise<boolean>;
};

class EZEZWebsocketServer {
    private readonly _options: Options;

    private readonly _deps: Deps;

    private socket: WebSocketServer | null = null;

    private readonly _clients: EZEZServerClient[] = [];

    public constructor(options: Options, deps: Deps) {
        this._options = options;
        this._deps = deps;
    }

    public start() {
        return new Promise<void>((resolve, reject) => {
            const wss = new WebSocketServer({ port: this._options.port });
            this.socket = wss;

            wss.on("connection", (client) => {
                this._clients.push(
                    new EZEZServerClient({ client }, {
                        onClose: (cl) => {
                            pull(this._clients, cl);
                        },
                        onAuth: this._deps.onAuth,
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
