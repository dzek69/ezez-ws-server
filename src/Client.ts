import type { WebSocket } from "ws";

import { unserialize } from "./data/unserialize";

type Deps = {
    client: WebSocket;
};

type Options = {
    onClose: (client: EZEZServerClient) => void;
    onAuth: (auth: string) => Promise<boolean>;
};

const AUTH_TIMEOUT = 5000;

class EZEZServerClient {
    private readonly _client: WebSocket;

    /**
     * Did the client send an auth message (it does not consider validating)?
     */
    private _authSent: boolean;

    private readonly _options: Options;

    public constructor(deps: Deps, options: Options) {
        this._client = deps.client;
        this._options = options;

        this._authSent = false;

        setTimeout(this._checkAuthTimeout, 5000);
        this._client.on("message", this._handleMessage);
        this._client.on("close", this._handleClose);
    }

    private readonly _handleMessage = (message: Buffer | string) => {
        if (!(message instanceof Buffer)) {
            // Whatever this is, it's officially not supported
            return;
        }
        const data = unserialize(message);
        console.log(data);
        if (data[0] === "auth") {
            this._authSent = true;
            this._options.onAuth(data[1] as string).then((result) => {
                if (result) {
                    console.log("Connection authenticated");
                }
                else {
                    // TODO should we notify the client?
                    this._client.close();
                }
            });
        }
    };

    private readonly _handleClose = () => {
        // notify parent
        console.log("Connection closed");
    };

    private readonly _checkAuthTimeout = () => {
        if (!this._authSent) {
            this._client.close();
        }
    };
}

export {
    EZEZServerClient,
};
