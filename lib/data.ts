import { badData, rangeNotSatisfiable } from '@hapi/boom';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataUrl = require('dataurl') as { parse: (uri: string) => { readonly data: Buffer; readonly mimetype: string; readonly charset?: string }};

import { register } from './registry';
import { UriReader, SharedReaderOptions } from './uri-reader';


export type DataReaderOptions = SharedReaderOptions;


export class UriDataReader extends UriReader {

    constructor(uri: URL, options = {}) {

        super(new URL('data:'), options);

        process.nextTick(() => {

            try {
                this.#process(uri);
            }
            catch (err: any) {
                return this._fetched(err);
            }

            return this._fetched();
        });
    }

    #process(uri: URL): void {

        const parsed = DataUrl.parse(uri.href);

        if (!parsed || !parsed.data) {
            throw badData();
        }

        const meta = { url: uri.href, mime: parsed.mimetype, size: parsed.data.length, modified: null };
        const limit = (this.end! >= 0) ? Math.min(this.end! + 1, meta.size) : meta.size;
        if (limit - this.start < 0) {
            const error = rangeNotSatisfiable();
            (error.output.headers as { [name: string]: string })['content-range'] = 'bytes */' + meta.size;
            throw error;
        }

        this.meta = meta;
        this.emit('meta', meta);

        if (!this.probe) {
            this.push(parsed.data.subarray(this.start, limit));
        }
    }
}

register('data', UriDataReader);
