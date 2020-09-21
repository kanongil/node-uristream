/// <reference types="node" />
import { UrlObject } from 'url';
import { PartialError } from './lib/partial-error';
import { register, isSupported } from './lib/registry';
import { UriReader } from './lib/uri-reader';
import { FileReaderOptions } from './lib/file.js';
import { HttpReaderOptions } from './lib/http.js';
import { DataReaderOptions } from './lib/data.js';

declare type UriStreamOptions = {
    /** Array of allowed uri schemes. If specified, will throw on non-matching schemes. */
    whitelist?: ReadonlyArray<string>;
    /** Array of blocked uri schemes, which will throw an error. */
    blacklist?: ReadonlyArray<string>;
};

declare type FullOptions = UriStreamOptions & DataReaderOptions & FileReaderOptions & HttpReaderOptions;

declare const _default: ((uri: string | UrlObject, options?: FullOptions) => UriReader) & {
    UriReader: typeof UriReader;
    PartialError: typeof PartialError;
    register: typeof register;
    isSupported: typeof isSupported;
};

export = _default;
