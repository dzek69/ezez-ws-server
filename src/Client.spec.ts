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

type TestCallbacks = {
    onError?: (error: Error) => void;
    onAuthRequest?: (authKey: string) => Promise<boolean>;
    onAuthOk?: () => void;
    onAuthRejected?: (reason: string) => void;
};

const startServer = async (callbacks?: TestCallbacks) => {
    const server = new EZEZWebsocketServer<Events>({ port: 0 }, {
        onAuthRequest: async (client, authKey) => {
            return callbacks?.onAuthRequest?.(authKey) ?? Promise.resolve(authKey === "valid-key");
        },
        onError: (client, error) => { callbacks?.onError?.(error); },
        onAuthOk: () => { callbacks?.onAuthOk?.(); },
        onAuthRejected: (client, reason) => { callbacks?.onAuthRejected?.(reason); },
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

const delay = async (ms: number) => {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
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
            const { server, port } = await startServer({ onError: (error) => { errors.push(error); } });

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

    describe("repeated auth frames", () => {
        it("processes only the first auth frame when multiple are pipelined", async () => {
            let authRequests = 0,
                authOks = 0;
            const { server, port } = await startServer({
                onAuthRequest: async (authKey) => {
                    authRequests++;
                    return Promise.resolve(authKey === "valid-key");
                },
                onAuthOk: () => { authOks++; },
            });

            try {
                const ws = await connect(port);
                let authOkFrames = 0;
                ws.on("message", (rawData) => {
                    const text = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : "";
                    if (text.includes(EVENT_AUTH_OK)) {
                        authOkFrames++;
                    }
                });

                for (let i = 0; i < 5; i++) {
                    ws.send(serialize(EVENT_AUTH, "valid-key", PROTOCOL_VERSION));
                }

                await delay(200);

                must(authRequests).equal(1);
                must(authOks).equal(1);
                must(authOkFrames).equal(1);

                ws.close();
            }
            finally {
                server.close();
            }
        });

        it("does not authenticate when a valid auth frame is pipelined after a rejected one", async () => {
            let authRequests = 0,
                authOks = 0,
                authRejections = 0;
            const { server, port } = await startServer({
                onAuthRequest: async (authKey) => {
                    authRequests++;
                    return Promise.resolve(authKey === "valid-key");
                },
                onAuthOk: () => { authOks++; },
                onAuthRejected: () => { authRejections++; },
            });

            try {
                const ws = await connect(port);
                const closePromise = waitForClose(ws);
                let gotAuthOk = false;
                ws.on("message", (rawData) => {
                    const text = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : "";
                    if (text.includes(EVENT_AUTH_OK)) {
                        gotAuthOk = true;
                    }
                });

                ws.send(serialize(EVENT_AUTH, "wrong-key", PROTOCOL_VERSION));
                ws.send(serialize(EVENT_AUTH, "valid-key", PROTOCOL_VERSION));

                await closePromise;
                // let any stray async auth resolution settle
                await delay(100);

                must(authRequests).equal(1);
                must(authRejections).equal(1);
                must(authOks).equal(0);
                must(gotAuthOk).be.false();
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
                await delay(200);

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
