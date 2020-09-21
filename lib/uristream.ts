import type { FileReaderOptions } from './file.js';
import type { HttpReaderOptions } from './http.js';
import type { DataReaderOptions } from './data.js';

import { parse, UrlObject } from 'url';

import { badRequest, forbidden } from '@hapi/boom';

import { PartialError } from './partial-error';
import { register, lookup, isSupported } from './registry';
import { UriReader } from './uri-reader';

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

const uristream = function (uri: string | UrlObject, options: FullOptions = {}) {

    const protocol = parse(uri as string).protocol || '';
    if (!protocol) {
        throw badRequest('Missing protocol in uri:', uri);
    }

    if (!isSupported(protocol)) {
        throw badRequest('Unsupported protocol:', protocol);
    }

    const scheme = protocol.slice(0, -1);
    if (options.whitelist && options.whitelist.indexOf(scheme) === -1) {
        throw forbidden('Protocol not allowed:', protocol);
    }

    if (options.blacklist && options.blacklist.indexOf(scheme) !== -1) {
        throw forbidden('Protocol not allowed:', protocol);
    }

    const readerClass = lookup(scheme)!;
    return new readerClass(uri, options);
};

export = Object.assign(uristream, { UriReader, PartialError, register, isSupported });
