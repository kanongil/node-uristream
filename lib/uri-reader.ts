import { parse, Url, UrlObject } from 'url';

import { Readable } from 'readable-stream';

export type SharedReaderOptions = {
    /** ReadableStream property that sets size of internal data buffer. Default undefined / let ReadableStream decide. */
    highWaterMark?: number;
    /** Fail request with timeout error after 'timeout' milliseconds. Default undefined / no timeout. */
    timeout?: number;
    /** Set to only retrieve metadata, and not transfer any file data. Default false. */
    probe?: boolean;
    /** Byte index to start from, default 0 */
    start?: number;
    /** Optional byte index to end at (inclusive) */
    end?: number;
};

type InternalReaderOptions = {
    autoDestroy?: boolean;
    emitClose?: boolean;
};

export type Meta = {
    url: string;
    mime: string;
    size: number;
    modified: Date | null;
    etag?: string;
};

export class UriReader extends Readable {

    readonly url: Url;
    meta?: Meta;

    readonly timeout?: number;
    readonly probe: boolean;
    readonly start: number;
    readonly end?: number;

    constructor(uri: string | UrlObject, { highWaterMark, autoDestroy = true, emitClose = true, ...options }: SharedReaderOptions & InternalReaderOptions = {}) {

        super({ highWaterMark, autoDestroy, emitClose } as any);

        this.url = parse(uri as string);

        // Options

        this.timeout = options.timeout;
        this.probe = !!options.probe;
        this.start = Number(options.start) || 0;
        this.end = Number(options.end) || undefined;

        // TODO: allow piping directly to a http response, like in request
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}
}
