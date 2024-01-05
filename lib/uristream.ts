import type { FileReaderOptions } from './file.js';
import type { HttpReaderOptions } from './http.js';
import type { DataReaderOptions } from './data.js';

import { badRequest, forbidden } from '@hapi/boom';

import { PartialError } from './partial-error.js';
import { register, lookup, isSupported } from './registry.js';
import { UriReader } from './uri-reader.js';

// Register handlers

import './file.js';
import './http.js';
import './data.js';

type UriStreamOptions = {
    /** Array of allowed uri schemes. If specified, will throw on non-matching schemes. */
    whitelist?: ReadonlyArray<string>;
    /** Array of blocked uri schemes, which will throw an error. */
    blacklist?: ReadonlyArray<string>;
};

type FullOptions = UriStreamOptions & DataReaderOptions & FileReaderOptions & HttpReaderOptions;

const uristream = function (uri: string | URL, options: FullOptions = {}) {

    try {
        uri = new URL(uri as string);
    }
    catch (err) {
        throw Object.assign(badRequest('Invalid URI string'), { cause: err });
    }

    const protocol = uri.protocol;
    if (!isSupported(protocol)) {
        throw badRequest(`Unsupported protocol: "${protocol}"`);
    }

    const scheme = protocol.slice(0, -1);
    if (options.whitelist && options.whitelist?.indexOf(scheme) === -1) {
        throw forbidden(`Protocol not allowed: "${protocol}"`);
    }

    if (options.blacklist && options.blacklist.indexOf(scheme) !== -1) {
        throw forbidden(`Protocol not allowed: "${protocol}"`);
    }

    const readerClass = lookup(scheme)!;
    return new readerClass(uri, options);
};

export default uristream;

export { UriReader, PartialError, register, isSupported };
