import { EZEZWebsocketServer } from "./index";

const PORT = 6565;

type IncomingEvents = {
    ping1: [];
    ping2: [number];
};

type OutgoingEvents = {
    pong1: [string];
    pong2: [];
};

const wss = new EZEZWebsocketServer<IncomingEvents, OutgoingEvents>({
    port: PORT,
    messagesBeforeAuth: "ignore",
    clearAwaitingRepliesAfterMs: 5_000,
}, {
    onAuthRequest: async (client, auth) => {
        return true;
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
            const replyId = reply("pong1", ["true"], /* (client, eventName, args, reply, ids) => {
                console.log("got a reply", eventName);
                reply("pong2", [], () => {
                    console.log("got a reply to pong2");
                });
            } */);
            console.info("replied to", ids.eventId, "with", replyId);
        }
    },
});

(async () => {
    await wss.start();
    console.info("Server started on port", PORT);

    setInterval(() => {
        // console.log("broadcasting");
        // wss.broadcast("test", ["hello world"]);
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    }, 2000);
})().catch((e: unknown) => {
    console.error("Could not start the server");
    console.error(e);
});
