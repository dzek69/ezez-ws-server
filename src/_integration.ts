import { EZEZWebsocketServer } from "./index";

const PORT = 6565;

const wss = new EZEZWebsocketServer<{ elo: [string] }>({
    port: PORT,
    messagesBeforeAuth: "ignore",
}, {
    onAuthRequest: async (client, auth) => {
        return true;
    },
    onAuthOk: (client) => {
        // client.send("invalid from server", [true]);
    },
    onMessage: (eventName, eventData, reply, ids) => {
        console.log("got some message!!!", {
            eventName,
            eventData,
            reply,
            ids,
        });

        if (eventName === "ping1") {
            const replyId = reply("pong1", ["true"], (eventName, args, reply, ids) => {
                console.log("got a reply", eventName);
                reply("pong2", [], () => {
                    console.log("got a reply to pong2");
                });
            });
            console.log("replied to", ids.eventId, "with", replyId);
        }
    },
});

(async () => {
    await wss.start();
    console.log("Server started on port", PORT);

    setInterval(() => {
        // console.log("broadcasting");
        // wss.broadcast("test", ["hello world"]);
    }, 2000);
})().catch((e) => {
    console.error("Could not start the server");
    console.error(e);
});
