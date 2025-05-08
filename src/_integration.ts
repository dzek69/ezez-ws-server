import { rethrow, wait } from "@ezez/utils";

import { EZEZWebsocketServer } from "./index";

const PORT = 6565;

const wss = new EZEZWebsocketServer({
    port: PORT,
    messagesBeforeAuth: "queue",
}, {
    onAuth: async (auth) => {
        console.log("authenticating", auth);
        await wait(1000);
        console.log("authenticated ok", auth);
        return true;
    },
    onMessage: (eventName, eventData, eventId, reply) => {
        console.log("got some message!!!", {
            eventName,
            // eventName, eventData, eventId, reply,
        });
    },
});

(async () => {
    await wss.start();
    console.log("Server started on port", PORT);

    setInterval(() => {
        console.log("broadcasting");
        wss.broadcast("test", ["hello world"]);
    }, 2000);
})().catch(rethrow);
