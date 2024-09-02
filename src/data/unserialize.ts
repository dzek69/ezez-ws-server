import { deserialize as ezezUnserialize } from "@ezez/utils";

import { BINARY_MARK_BIN, BINARY_MARK_MAP, BINARY_MARK_STRING } from "./const.js";

const MAX_DATA_PARTS = 4;

const tryJson = (data: string): unknown => {
    try {
        return ezezUnserialize(data);
    }
    catch {
        return data;
    }
};

const bufferToString = (bufferData: Uint8Array) => {
    if (typeof TextDecoder === "undefined") {
        return Buffer.from(bufferData).toString("utf8");
    }
    return new TextDecoder("utf-8").decode(bufferData);
};

const NOT_FOUND = -1;
const LAST_CHAR = -1;

const unserialize = <RT extends any[] = unknown[]>(rawData: Buffer | Uint8Array): RT => { // eslint-disable-line max-statements,@typescript-eslint/no-explicit-any
    const intData: Uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);

    if (intData.length === 0) {
        throw new Error("No data to unserialize");
    }

    let startPoint = 0;
    const result = [];

    let i = 0;
    while (i++ < MAX_DATA_PARTS) {
        const dataSplitPoint = intData.indexOf(0, startPoint); // find null
        if (dataSplitPoint === NOT_FOUND) { // no null found = no data
            break;
        }
        const lengthBytes = bufferToString(intData.slice(startPoint, dataSplitPoint));
        const binaryMark = lengthBytes.substr(LAST_CHAR) as keyof typeof BINARY_MARK_MAP;
        if (!Object.keys(BINARY_MARK_MAP).includes(binaryMark)) {
            throw new Error(`Invalid binary mark: ${binaryMark}`);
        }

        const len = Number(lengthBytes.substr(0, lengthBytes.length - 1));

        const dataStringFrom = dataSplitPoint + 1;
        const dataStringTo = dataStringFrom + len;
        const dataBytes = intData.slice(dataStringFrom, dataStringTo);

        if (binaryMark === BINARY_MARK_BIN) {
            result.push(dataBytes);
        }
        else if (binaryMark === BINARY_MARK_STRING) {
            const stringData = bufferToString(dataBytes);
            result.push(stringData);
        }
        else {
            const stringData = bufferToString(dataBytes);
            const jsonData = tryJson(stringData);
            result.push(jsonData);
        }

        startPoint = dataStringTo + 1; // skip separating null
    }

    if (result.length === 0) {
        throw new Error("No data found (no split points)");
    }

    return result as RT;
};

export { unserialize };
