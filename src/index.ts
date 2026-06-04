import { ensureError, omit, pick, pull, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import { WebSocketServer } from "ws";

import type { OnCallback } from "./Client";
import type { Callbacks, ClientOptions, EZEZServerOptions, TEvents } from "./types";

import { EZEZServerClient } from "./Client";

/**
 * Combined options for the WebSocket server, merging server-level options (from `ws` library)
 * with client behavior options specific to `@ezez/ws-server`.
 *
 * Includes all options from `EZEZServerOptions` and `ClientOptions`.
 *
 * When the `TContext` generic is specified, `defaultContext` becomes a required field, used to seed each connected client's `context` (via `structuredClone`).
 */
type Options<TContext extends object = Record<string, never>>
    = [TContext] extends [Record<string, never>]
        ? EZEZServerOptions & ClientOptions & { defaultContext?: TContext }
        : EZEZServerOptions & ClientOptions & { defaultContext: TContext };

const defaultOptions: Required<ClientOptions> = {
    messagesBeforeAuth: "ignore",
    sendAfterDisconnect: "ignore",
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    clearAwaitingRepliesAfterMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * WebSocket server with built-in authentication, type-safe events, and reply tracking.
 *
 * Wraps the native `ws` {@link https://github.com/websockets/ws | WebSocketServer} and provides:
 * - Type-safe event-based messaging via TypeScript generics
 * - Built-in authentication flow with configurable timeout
 * - Message queuing for pre-auth messages
 * - Reply tracking with automatic cleanup
 * - Broadcasting to all connected clients
 *
 * Supports three operational modes:
 * - **Standalone** - creates its own HTTP server (pass `port` in options)
 * - **External server** - attaches to an existing HTTP server (pass `server` in options)
 * - **Manual upgrade** - no automatic attachment, you handle upgrades yourself (pass `noServer: true`)
 *
 * @template IncomingEvents - Map of event names to argument tuples that clients can send to this server
 * @template OutgoingEvents - Map of event names to argument tuples that this server can send to clients.
 *   Defaults to `IncomingEvents` if not specified (bidirectional events).
 * @template TContext - Shape of the per-client mutable context bag accessible via `client.context`.
 *   Defaults to `Record<string, never>` (no context) if not specified. When set, you must provide a
 *   `defaultContext` option that will be `structuredClone`d into each new client.
 *
 * @example
 * ```typescript
 * type FromClient = {
 *     ping: [message: string];
 *     getData: [id: number];
 * };
 *
 * type FromServer = {
 *     pong: [message: string];
 *     data: [id: number, payload: string];
 * };
 *
 * const server = new EZEZWebsocketServer<FromClient, FromServer>(
 *     { port: 8080 },
 *     {
 *         onAuthRequest: async (client, authKey) => authKey === "secret",
 *         onAuthOk: (client) => {
 *             client.send("pong", ["connected!"]);
 *         },
 *     },
 * );
 *
 * await server.start();
 * ```
 */
class EZEZWebsocketServer<
    IncomingEvents extends TEvents,
    OutgoingEvents extends TEvents = IncomingEvents,
    TContext extends object = Record<string, never>,
> {
    private readonly _options: EZEZServerOptions & Required<ClientOptions>;

    private readonly _defaultContext: TContext;

    private readonly _callbacks: Callbacks<IncomingEvents, OutgoingEvents, TContext>;

    private _wss: WebSocketServer | null = null;

    private readonly _clients: Array<EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>> = [];

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    /**
     * Creates a new WebSocket server instance.
     *
     * The server is not started until {@link start} is called.
     *
     * @param options - Server and client behavior configuration. Must include one of: `port` (standalone),
     *   `server` (external server), or `noServer: true` (manual upgrade handling).
     * @param callbacks - Lifecycle callbacks for authentication, messages, disconnections, and errors.
     * @throws Error if `clearAwaitingRepliesAfterMs` is set to 0 or less.
     */
    public constructor(
        options: Options<TContext>, callbacks: Callbacks<IncomingEvents, OutgoingEvents, TContext>,
    ) {
        const {
            defaultContext, ...rest
        } = options as EZEZServerOptions & ClientOptions & { defaultContext?: TContext };
        this._options = { ...defaultOptions, ...rest };
        if (this._options.clearAwaitingRepliesAfterMs <= 0) {
            throw new Error("`clearAwaitingRepliesAfterMs` must be greater than 0");
        }
        this._defaultContext = (defaultContext ?? {}) as TContext;
        this._callbacks = callbacks;

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);
    }

    /**
     * Starts the server and begins listening for connections.
     *
     * - In **standalone** mode (with `port`), the promise resolves once the server is listening.
     * - In **external server** or **noServer** mode, the promise resolves immediately after setup.
     *
     * @returns A promise that resolves when the server is ready to accept connections.
     * @throws Error if the server fails to start (e.g., port is already in use).
     */
    // eslint-disable-next-line max-lines-per-function
    public start() {
        // eslint-disable-next-line max-lines-per-function
        return new Promise<void>((resolve, reject) => {
            try {
                const wss = new WebSocketServer(omit(this._options, [
                    "serializerArgs", "unserializerArgs", "messagesBeforeAuth", "sendAfterDisconnect",
                ]));
                this._wss = wss;

                let fulfilled = false;

                wss.on("connection", (client) => {
                    this._clients.push(
                        new EZEZServerClient<IncomingEvents, OutgoingEvents, TContext>({
                            client,
                            serialize: this._serialize,
                            unserialize: this._unserialize,
                            context: structuredClone(this._defaultContext),
                        }, {
                            onClose: (cl) => {
                                pull(this._clients, cl);
                            },
                            onAuthRequest: this._callbacks.onAuthRequest,
                            onAuthOk: this._callbacks.onAuthOk,
                            onAuthRejected: this._callbacks.onAuthRejected,
                            onMessage: this._callbacks.onMessage,
                            onDisconnect: this._callbacks.onDisconnect,
                            onError: this._callbacks.onError,
                        }, pick(this._options, [
                            "messagesBeforeAuth",
                            "sendAfterDisconnect",
                            "clearAwaitingRepliesAfterMs",
                        ])),
                    );
                });

                if (this._options.server || this._options.noServer) {
                    resolve();
                    fulfilled = true;
                }
                else {
                    wss.once("listening", () => {
                        if (fulfilled) {
                            throw new Error("Unexpected `listening` event after `error`");
                        }
                        resolve();
                        fulfilled = true;
                    });
                }

                wss.once("error", (e) => {
                    if (fulfilled) {
                        throw new Error("Unexpected `error` event after `listening`");
                    }
                    reject(e);
                    fulfilled = true;
                });
            }
            catch (e) {
                reject(ensureError(e));
            }
        });
    }

    /**
     * Sends a message to all currently connected and authenticated clients.
     *
     * @param eventName - The event name to broadcast.
     * @param args - The arguments to send with the event.
     */
    public broadcast<T extends keyof OutgoingEvents>(eventName: T, args: OutgoingEvents[T]) {
        this._clients.forEach((client) => {
            client.send(eventName, args);
        });
    }

    /**
     * Gets a shallow copy of the list of currently connected clients.
     */
    public get clients() {
        return [...this._clients];
    }

    /**
     * Gets the underlying `ws` WebSocketServer instance, or `null` if the server is not started or has been closed.
     *
     * @remarks
     * Sending messages directly through this instance will bypass the library's serialization protocol
     * and will likely cause parsing errors on connected clients.
     */
    public get wss() {
        return this._wss;
    }

    /**
     * Stops the server, closes all client connections, and clears the client list.
     *
     * After calling this method, the server can no longer accept connections. The {@link wss} getter will return `null`.
     */
    public close() {
        if (this._wss) {
            this._wss.close();
            this._wss = null;
            this._clients.length = 0;
        }
    }
}

export { EZEZWebsocketServer };
export type { Options, EZEZServerClient, OnCallback };
