const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_REJECTED = "ezez-ws::auth-rejected";

type ReservedNames = typeof EVENT_AUTH | typeof EVENT_AUTH_REJECTED;
type ReservedEventKeys<T extends string> = {
    [K in T]?: never;
};
type TEvents = Record<string, unknown[]> & ReservedEventKeys<ReservedNames>;

export {
    EVENT_AUTH,
    EVENT_AUTH_REJECTED,
};

export type {
    TEvents,
};
