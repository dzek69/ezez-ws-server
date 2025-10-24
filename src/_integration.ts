import fastify from "fastify";

import type { Options } from "./index";

import { EZEZWebsocketServer } from "./index";

const USE_FASTIFY = false;
const MANUAL_FASTIFY = true;

const PORT = 6565;

type IncomingEvents = {
    ping1: [];
    ping2: [number];
};

type OutgoingEvents = {
    pong1: [string];
    pong2: [];
};

const createWss = (options: Options) => {
    return new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>({
        ...options,
        messagesBeforeAuth: "ignore",
        clearAwaitingRepliesAfterMs: 5_000,
    }, {
        onAuthRequest: (client, auth) => {
            return Promise.resolve(true);
        },
        onAuthOk: (client) => {
        // client.send("invalid from server", [true]);
            client.on("ping1", (args, reply) => {
                console.info("ping1");
            });
            client.on("ping2", (args, reply) => {
                console.info("got ping2 from client, let's reply with pong2", args);
                reply("pong2", [], () => {
                    console.info("got inside reply to pong2");
                });
            });
        },
        onMessage: (client, eventName, eventData, reply, ids) => {
            console.info("got some message!!!", {
                eventName,
                eventData,
                reply,
                ids,
            });

            if (eventName === "ping1") {
                const replyId = reply("pong1", ["óóó"], /* (client, eventName, args, reply, ids) => {
                console.log("got a reply", eventName);
                reply("pong2", [], () => {
                    console.log("got a reply to pong2");
                });
            } */);
                console.info("replied to", ids.eventId, "with", replyId);
            }
        },
    });
};

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
