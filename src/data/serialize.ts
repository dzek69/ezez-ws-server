import { serialize as ezezSerialize } from "@ezez/utils";

import { BINARY_MARK_BIN, BINARY_MARK_JSON, BINARY_MARK_STRING } from "./const.js";

const separator = Buffer.from([0x0]);

type DataType = {
    mark: typeof BINARY_MARK_BIN;
    data: Buffer;
} | {
    mark: typeof BINARY_MARK_STRING;
    data: string;
} | {
    mark: typeof BINARY_MARK_JSON;
    data: unknown;
};

const serialize = (...args: unknown[]): Buffer => {
    const convertedArgs = args.map((arg) => {
        if (arg instanceof Buffer) {
            return {
                mark: BINARY_MARK_BIN,
                data: arg,
            } satisfies DataType;
        }
        if (typeof arg === "string") {
            return {
                mark: BINARY_MARK_STRING,
                data: arg,
            } satisfies DataType;
        }
        return {
            mark: BINARY_MARK_JSON,
            data: ezezSerialize(arg),
        } satisfies DataType;
    });
    const dataToSend: Buffer[] = [];
    let totalLength = 0;
    convertedArgs.forEach((arg) => {
        const len = String(arg.data.length) + arg.mark;

        dataToSend.push(Buffer.from(len, "utf-8"));
        dataToSend.push(separator);
        dataToSend.push(arg.mark === BINARY_MARK_BIN ? arg.data : Buffer.from(arg.data, "utf-8"));
        dataToSend.push(separator);

        totalLength += len.length + separator.length + arg.data.length + separator.length;
    });

    return Buffer.concat(dataToSend, totalLength);
};

export {
    serialize,
};
