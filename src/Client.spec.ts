import { serializeToBuffer } from "@ezez/utils";
import must from "must";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";

import { EZEZWebsocketServer } from "./index.js";

type Events = {
    ping: [message: string];
};

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
const PROTOCOL_VERSION = 1;
const CLOSE_PROTOCOL_ERROR = 1002;

const serialize = (...args: unknown[]) => serializeToBuffer(Buffer, [], ...args);

const startServer = async (onError?: (error: Error) => void) => {
    const server = new EZEZWebsocketServer<Events>({ port: 0 }, {
        onAuthRequest: async (client, authKey) => Promise.resolve(authKey === "valid-key"),
        onError: (client, error) => { onError?.(error); },
    });
    await server.start();
    const address = server.wss!.address();
    if (typeof address === "string" || !address) {
        throw new Error("Expected address info with a port");
    }
    return { server, port: address.port };
};

const connect = async (port: number) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });
    return ws;
};

const waitForClose = async (ws: WebSocket) => {
    return new Promise<{ code: number }>((resolve) => {
        ws.once("close", (code) => { resolve({ code }); });
    });
};

const authenticate = async (ws: WebSocket) => {
    return new Promise<void>((resolve, reject) => {
        ws.once("message", (rawData) => {
            const text = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : "";
            if (text.includes(EVENT_AUTH_OK)) {
                resolve();
                return;
            }
            reject(new Error(`Unexpected message: ${text}`));
        });
        ws.send(serialize(EVENT_AUTH, "valid-key", PROTOCOL_VERSION));
    });
};

describe("EZEZServerClient", () => {
    describe("malformed messages handling", () => {
        it("does not crash the process and closes the connection on garbage data", async () => {
            const errors: Error[] = [];
            const { server, port } = await startServer((error) => { errors.push(error); });

            try {
                const ws = await connect(port);
                const closePromise = waitForClose(ws);

                ws.send(Buffer.from([0x01])); // not a valid protocol frame

                const { code } = await closePromise;
                must(code).equal(CLOSE_PROTOCOL_ERROR);
                must(errors.length).equal(1);

                // server must still accept and authenticate new connections
                const ws2 = await connect(port);
                await authenticate(ws2);
                ws2.close();
            }
            finally {
                server.close();
            }
        });

        it("survives various malformed payloads", async () => {
            const { server, port } = await startServer();

            try {
                const payloads = [
                    Buffer.alloc(0), // empty
                    Buffer.from("no separators at all"),
                    Buffer.from("5x\0hello\0"), // invalid binary mark
                    Buffer.from("5j\0!!!!!\0"), // json mark, invalid json
                ];

                for (const payload of payloads) {
                    const wsClient = await connect(port);
                    const closePromise = waitForClose(wsClient);
                    wsClient.send(payload);
                    const { code } = await closePromise;
                    must(code).equal(CLOSE_PROTOCOL_ERROR);
                }

                const ws = await connect(port);
                await authenticate(ws);
                ws.close();
            }
            finally {
                server.close();
            }
        });
    });

    describe("broadcast", () => {
        it("reaches authenticated clients but skips unauthenticated ones", async () => {
            const { server, port } = await startServer();

            try {
                const authed = await connect(port);
                await authenticate(authed);

                const unauthed = await connect(port);
                // deliberately not authenticated

                let authedGotPing = false;
                authed.on("message", (rawData) => {
                    const text = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : "";
                    if (text.includes("ping")) {
                        authedGotPing = true;
                    }
                });

                let unauthedGotAnything = false;
                unauthed.on("message", () => { unauthedGotAnything = true; });

                server.broadcast("ping", ["hello"]);

                // give the event loop time to deliver any (wrongly) sent frames
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 200);
                    timer.unref?.();
                });

                must(authedGotPing).be.true();
                must(unauthedGotAnything).be.false();

                authed.close();
                unauthed.close();
            }
            finally {
                server.close();
            }
        });
    });
});
