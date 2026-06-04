import fastify from "fastify";

import type { OnCallback } from "./Client";
import type { Options } from "./index";

import { EZEZWebsocketServer } from "./index";

const USE_FASTIFY = false;
const MANUAL_FASTIFY = true;

const PORT = 6565;

type IncomingEvents = {
    ping1: [];
    ping2: [number, number];
};

type OutgoingEvents = {
    pong1: [string, string];
    pong2: [];
};

type ClientContext = {
    userId: number | null;
    nickname: string;
    pingCount: number;
    rooms: string[];
};

/* eslint-disable no-param-reassign */
// eslint-disable-next-line max-lines-per-function
const createWss = (options: Options) => {
    const ws = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents, ClientContext>({
        ...options,
        messagesBeforeAuth: "ignore",
        clearAwaitingRepliesAfterMs: 5_000,
        defaultContext: {
            userId: null,
            nickname: "anonymous",
            pingCount: 0,
            rooms: ["lobby"],
        },
    }, {
        onAuthRequest: (client, auth) => {
            console.info("auth request received:", auth, "| default ctx:", client.context);
            // pretend the auth string is "userId:nickname", e.g. "42:alice"
            const [rawId, nick] = auth.split(":");
            client.context.userId = Number(rawId) || 0;
            client.context.nickname = nick ?? "anonymous";
            return Promise.resolve(true);
        },
        onAuthOk: (client) => {
            console.info("ok | ctx after auth:", client.context);
            client.context.rooms.push("authenticated");

            client.on("ping1", (args, reply, ids) => {
                client.context.pingCount++;
                console.info(
                    `ping1 from #${client.connectionId} (${client.context.nickname}),`
                    + ` total pings: ${client.context.pingCount}`,
                    "| rooms:", client.context.rooms,
                );
            });
            client.send("pong1", ["a", "b"]);

            const fn: OnCallback<typeof ws, "ping2"> = (args, reply, ids) => {
                client.context.pingCount++;
                console.info(
                    `ping2 from ${client.context.nickname}, total: ${client.context.pingCount}`,
                    "args:", args,
                );
                reply("pong1", ["x", "d"], () => {
                    console.info("got inside reply to pong2");
                });
                client.client.send(`{"raw": "message"}`);
            };

            client.on("ping2", fn);
        },
        onMessage: (client, eventName, eventData, reply, ids) => {
            console.info("got some message!!!", {
                eventName,
                eventData,
                reply,
                ids,
                userId: client.context.userId,
                nickname: client.context.nickname,
            });

            if (eventName === "ping1") {
                const replyId = reply("pong1", ["óóó", "999"]);
                console.info("replied to", ids.eventId, "with", replyId);
            }
        },
        onDisconnect: (client, code, reason) => {
            console.info(
                `client #${client.connectionId} (${client.context.nickname}) disconnected,`
                + ` had ${client.context.pingCount} pings, code=${code}, reason=${reason}`,
            );
        },
    });

    // sanity check: every 3s log all clients' contexts
    setInterval(() => {
        if (ws.clients.length === 0) {
            return;
        }
        console.info("--- contexts snapshot ---");
        ws.clients.forEach((c) => {
            console.info(`  #${c.connectionId}:`, c.context);
        });
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    }, 3000);

    return ws;
};
/* eslint-enable no-param-reassign */

(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const webServer = USE_FASTIFY
        ? fastify({ ignoreTrailingSlash: true })
        : null;

    console.info("Will", webServer ? "use" : "not use", "Fastify web server");

    const wss = createWss(webServer
        ? (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            !MANUAL_FASTIFY ? { server: webServer.server } : { noServer: true }
        )
        : { port: PORT });

    if (webServer) {
        await webServer.listen({ port: PORT });
        console.info("Fastify started on", PORT);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (MANUAL_FASTIFY) {
            webServer.server.on("upgrade", (request, socket, head) => {
                // always return 401:
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            });
        }
    }
    await wss.start();
    console.info("Websocket server started", webServer ? "with Fastify" : `on port ${PORT}`);

    setInterval(() => {
        // console.log("broadcasting");
        // wss.broadcast("test", ["hello world"]);
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    }, 2000);
})().catch((e: unknown) => {
    console.error("Could not start the server");
    console.error(e);
});
