import { format, UrlObject } from 'url';

import { badData, rangeNotSatisfiable } from '@hapi/boom';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataUrl = require('dataurl') as { parse: (uri: string) => { readonly data: Buffer; readonly mimetype: string; readonly charset?: string }};

import { register } from './registry';
import { UriReader, SharedReaderOptions } from './uri-reader';


export type DataReaderOptions = SharedReaderOptions;


export class UriDataReader extends UriReader {

    constructor(uri: string | UrlObject, options = {}) {

        super('data:', options);

        if (typeof uri !== 'string') {
            uri = format(uri);
        }

        const parsed = DataUrl.parse(uri);

        if (!parsed || !parsed.data) {
            return this.destroy(badData());
        }

        const meta = { url: uri, mime: parsed.mimetype, size: parsed.data.length, modified: null };
        const limit = (this.end! >= 0) ? this.end! + 1 : meta.size;
        const bytes = limit - this.start;

        if (limit > meta.size || bytes < 0) {
            return this.destroy(rangeNotSatisfiable());
        }

        process.nextTick(() => {

            this.meta = meta;
            this.emit('meta', meta);

            if (!this.probe) {
                this.push(parsed.data.slice(this.start, this.end! >= 0 ? this.end! + 1 : undefined));
            }

            this.push(null);
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}
}

register('data', UriDataReader);
