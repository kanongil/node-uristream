import { Readable } from 'node:stream';


export type SharedReaderOptions = {
    /** Readable property that sets size of internal data buffer. Default undefined / let Readable decide. */
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

export type Meta = {
    url: string;
    mime: string;
    size: number;
    modified: Date | null;
    etag?: string;
};

export class UriReader extends Readable {

    readonly url: URL;
    meta?: Meta;

    readonly timeout?: number;
    readonly probe: boolean;
    readonly start: number;
    readonly end?: number;

    #deferredError?: Error;

    constructor(uri: URL, { highWaterMark, ...options }: SharedReaderOptions = {}) {

        super({ highWaterMark, autoDestroy: true, emitClose: true } as any);

        this.url = uri;

        // Options

        this.timeout = options.timeout;
        this.probe = !!options.probe;
        this.start = Number(options.start) || 0;
        this.end = Number(options.end) || undefined;

        // TODO: allow piping directly to a http response, like in request
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}

    /**
     * Called by subclasses to signal that no more data will be fetched from the underlying resource.
     *
     * This is responsible for closing the stream.
     */
    protected _fetched(err?: Error): void {

        const usesFetched = this.emit('fetched', err);

        if (err) {
            if (usesFetched) {
                this.#deferredError ??= err;    // Defer destroy until all data has been consumed
                this.push(null);                // Signal stream end
            }
            else {
                this.destroy(err);              // Use regular flow
            }
        }
        else {
            this.push(null);                    // Use regular flow
        }
    }

    emit(event: string, arg?: unknown): any {

        if (this.#deferredError) {
            if (event === 'end') {
                this.destroy(this.#deferredError);          // Cancel 'end' emit
                return;
            }
            else if (event === 'error') {
                this.#deferredError = undefined;            // The user supplied error supercedes the stored error
            }
        }

        return super.emit(event, arg);
    }
}
