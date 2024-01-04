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

            const parsed = DataUrl.parse(uri.href);

            if (!parsed || !parsed.data) {
                return this.destroy(badData());
            }

            const meta = { url: uri.href, mime: parsed.mimetype, size: parsed.data.length, modified: null };
            const limit = (this.end! >= 0) ? Math.min(this.end! + 1, meta.size) : meta.size;
            if (limit - this.start < 0) {
                const error = rangeNotSatisfiable();
                (error.output.headers as { [name: string]: string })['content-range'] = 'bytes */' + meta.size;
                return this.destroy(error);
            }

            this.meta = meta;
            this.emit('meta', meta);

            if (!this.probe) {
                this.push(parsed.data.subarray(this.start, limit));
            }

            this.push(null);
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}
}

register('data', UriDataReader);
