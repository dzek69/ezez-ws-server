import { rethrow } from "@ezez/utils";

import { EZEZWebsocketServer } from "./index";

const PORT = 6565;

const wss = new EZEZWebsocketServer({ port: PORT }, {
    onAuth: async (auth) => {
        console.log("authenticating", auth);
        return true;
    },
});
(async () => {
    await wss.start();
    console.log("Server started on port", PORT);
})().catch(rethrow);
