import { serializeToBuffer } from "@ezez/utils";
import must from "must";
// eslint-disable-next-line @typescript-eslint/no-shadow
import { WebSocket } from "ws";

import type { EZEZServerClient } from "./index.js";

import { EZEZWebsocketServer } from "./index.js";

type Events = {
    ping: [message: string];
};

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
const PROTOCOL_VERSION = 1;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;

const serialize = (...args: unknown[]) => serializeToBuffer(Buffer, [], ...args);

type TestCallbacks = {
    onError?: (error: Error) => void;
    onAuthRequest?: (authKey: string) => Promise<boolean>;
    onAuthOk?: () => void;
    onAuthRejected?: (reason: string) => void;
    onMessage?: (eventName: string, args: unknown[]) => void;
};

type TestOptions = {
    authTimeoutMs?: number;
    messagesBeforeAuth?: "ignore" | "queue" | "accept";
    queueLimitBytes?: number;
    queueOverflow?: "ignore" | "disconnect" | ((client: EZEZServerClient<Events>, byteLength: number) => void);
    maxPayload?: number;
};

const startServer = async (callbacks?: TestCallbacks, options?: TestOptions) => {
    const server = new EZEZWebsocketServer<Events>({ port: 0, ...options }, {
        onAuthRequest: async (client, authKey) => {
            return callbacks?.onAuthRequest?.(authKey) ?? Promise.resolve(authKey === "valid-key");
        },
        onError: (client, error) => { callbacks?.onError?.(error); },
        onAuthOk: () => { callbacks?.onAuthOk?.(); },
        onAuthRejected: (client, reason) => { callbacks?.onAuthRejected?.(reason); },
        onMessage: (client, eventName, args) => { callbacks?.onMessage?.(eventName, args); },
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

    describe("zombie connections", () => {
        it("rejects and disconnects the client when onAuthRequest throws", async () => {
            const errors: Error[] = [];
            const rejections: string[] = [];
            const { server, port } = await startServer({
                onAuthRequest: async () => Promise.reject(new Error("database exploded")),
                onError: (error) => { errors.push(error); },
                onAuthRejected: (reason) => { rejections.push(reason); },
            });

            try {
                const ws = await connect(port);
                const closePromise = waitForClose(ws);
                let gotAuthRejected = false;
                ws.on("message", (rawData) => {
                    const text = Buffer.isBuffer(rawData) ? rawData.toString("utf8") : "";
                    if (text.includes("Auth verification failed")) {
                        gotAuthRejected = true;
                    }
                });

                ws.send(serialize(EVENT_AUTH, "valid-key", PROTOCOL_VERSION));

                await closePromise;

                must(gotAuthRejected).be.true();
                must(rejections).eql(["Auth verification failed"]);
                must(errors.length).equal(1);
                must(errors[0]!.message).equal("database exploded");
            }
            finally {
                server.close();
            }
        });

        it("times out and disconnects the client when no auth message is sent at all", async () => {
            const rejections: string[] = [];
            const { server, port } = await startServer({
                onAuthRejected: (reason) => { rejections.push(reason); },
            }, { authTimeoutMs: 100 });

            try {
                const ws = await connect(port);
                const closePromise = waitForClose(ws);

                await closePromise;

                must(rejections).eql(["Auth timeout"]);
            }
            finally {
                server.close();
            }
        });
    });

    describe("pre-auth queue limit", () => {
        it("drops overflowing messages by default and processes the rest after auth", async () => {
            const frame1 = serialize("ping", 1, null, "first");
            const frame2 = serialize("ping", 2, null, "second-does-not-fit");
            // both frames individually fit in maxPayload, but together they overflow the queue
            const queueLimitBytes = frame1.length + frame2.length - 1;
            const received: Array<[string, unknown[]]> = [];
            const { server, port } = await startServer({
                onMessage: (eventName, args) => { received.push([eventName, args]); },
            }, { messagesBeforeAuth: "queue", queueLimitBytes, maxPayload: queueLimitBytes });

            try {
                const ws = await connect(port);
                ws.send(frame1);
                ws.send(frame2);
                await authenticate(ws);
                await delay(100);

                must(received).eql([["ping", ["first"]]]);
                must(ws.readyState).equal(WebSocket.OPEN);
                ws.close();
            }
            finally {
                server.close();
            }
        });

        it("disconnects a client that overflows the queue with queueOverflow: disconnect", async () => {
            const frame1 = serialize("ping", 1, null, "first");
            const frame2 = serialize("ping", 2, null, "second-does-not-fit");
            const queueLimitBytes = frame1.length + frame2.length - 1;
            const { server, port } = await startServer({}, {
                messagesBeforeAuth: "queue",
                queueOverflow: "disconnect",
                queueLimitBytes,
                maxPayload: queueLimitBytes,
            });

            try {
                const ws = await connect(port);
                const closePromise = waitForClose(ws);

                ws.send(frame1);
                ws.send(frame2);

                const { code } = await closePromise;
                must(code).equal(CLOSE_POLICY_VIOLATION);
            }
            finally {
                server.close();
            }
        });

        it("calls the queueOverflow callback and keeps the connection", async () => {
            const frame1 = serialize("ping", 1, null, "first");
            const frame2 = serialize("ping", 2, null, "second-does-not-fit");
            const queueLimitBytes = frame1.length + frame2.length - 1;
            const overflows: number[] = [];
            const { server, port } = await startServer({}, {
                messagesBeforeAuth: "queue",
                queueOverflow: (client, byteLength) => { overflows.push(byteLength); },
                queueLimitBytes,
                maxPayload: queueLimitBytes,
            });

            try {
                const ws = await connect(port);
                ws.send(frame1);
                ws.send(frame2);
                await delay(100);

                must(overflows).eql([frame2.length]);
                must(ws.readyState).equal(WebSocket.OPEN);
                ws.close();
            }
            finally {
                server.close();
            }
        });

        it("processes messages queued within the limit after successful auth", async () => {
            const received: Array<[string, unknown[]]> = [];
            const { server, port } = await startServer({
                onMessage: (eventName, args) => { received.push([eventName, args]); },
            }, { messagesBeforeAuth: "queue" });

            try {
                const ws = await connect(port);
                ws.send(serialize("ping", 1, null, "queued-hello"));
                await authenticate(ws);
                await delay(100);

                must(received).eql([["ping", ["queued-hello"]]]);
                ws.close();
            }
            finally {
                server.close();
            }
        });

        it("throws at init when a single message can't fit in the queue", () => {
            must(() => new EZEZWebsocketServer<Events>(
                { port: 0, messagesBeforeAuth: "queue", queueLimitBytes: 100, maxPayload: 200 },
                { onAuthRequest: async () => Promise.resolve(true) },
            )).throw(/must fit within/u);
        });
    });

    describe("payload size limit", () => {
        it("natively disconnects a client sending a message over maxPayload", async () => {
            const { server, port } = await startServer({}, { maxPayload: 200 });

            try {
                const ws = await connect(port);
                await authenticate(ws);
                const closePromise = waitForClose(ws);

                ws.send(serialize("ping", 1, null, "x".repeat(1000)));

                const { code } = await closePromise;
                must(code).equal(CLOSE_MESSAGE_TOO_BIG);
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
