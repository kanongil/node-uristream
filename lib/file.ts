// RFC 1738 file: URI support

import type { Readable } from 'node:stream';

import * as Fs from 'node:fs/promises';

import * as Boom from '@hapi/boom';
import { ignore } from '@hapi/hoek';
import { lookup } from 'mime-types';
import Oncemore from 'oncemore';
import { default as Debug } from 'debug';
const debug = Debug('uristream:file');

import { register } from './registry.js';
import { UriReader, SharedReaderOptions } from './uri-reader.js';


export type FileReaderOptions = SharedReaderOptions;


const pump = function <S extends Readable, D extends Readable> (src: S, dst: D): Promise<void> {

    return new Promise((resolve, reject) => {

        src.on('data', (chunk) => {

            if (!dst.push(chunk)) {
                src.pause();
            }
        });

        Oncemore(src).once('end', 'error', (err: Error) => {

            // TODO: flush source buffer on error?
            dst._read = ignore;

            err ? reject(err) : resolve();
        });

        dst._read = (n) => {

            src.resume();
        };
    });
};

export class UriFileReader extends UriReader {

    private _timeoutId?: NodeJS.Timeout;
    private _src?: ReturnType<Fs.FileHandle['createReadStream']>;

    readonly path: string;

    constructor(uri: URL, options: FileReaderOptions = {}) {

        super(uri, options);

        if (!(this.url.host === '' || this.url.host === 'localhost')) {
            throw Boom.badRequest('only local file uri\' are supported: ' + this.url.href);
        }

        this.path = this.url.pathname!;

        if (this.timeout) {
            this._timeoutId = setTimeout(() => {

                this.destroy(Boom.gatewayTimeout());
            }, this.timeout);
        }

        this.#process()
            .finally(() => {

                clearTimeout(this._timeoutId);
                this._src?.destroy();
            })
            .then(() => this._fetched(), (err) => this._fetched(err));
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}

    async #process(): Promise<void> {

        let stats;
        let handle: Fs.FileHandle | undefined = undefined;
        let bytes: number;

        try {
            try {
                if (this.probe) {
                    stats = await Fs.stat(this.path);
                }
                else {
                    handle = await Fs.open(this.path, 'r');
                    stats = await handle.stat();
                }
            }
            catch (thrownErr: any) {
                let err = thrownErr as NodeJS.ErrnoException;

                if (err.code === 'ENOENT') {
                    err = Boom.notFound('no such file');
                }
                else if (err.code === 'EACCES') {
                    err = Boom.forbidden('permission error');
                }
                else {
                    err = Boom.badImplementation('unknown access error: ' + err.code, thrownErr);
                }

                throw err;
            }

            if (stats.isDirectory()) {
                throw Boom.forbidden('directory listing is not allowed');
            }

            const limit = (this.end! >= 0) ? Math.min(this.end! + 1, stats.size) : stats.size;
            bytes = limit - this.start;

            if (bytes < 0) {
                const error = Boom.rangeNotSatisfiable();
                (error.output.headers as { [name: string]: string })['content-range'] = 'bytes */' + stats.size;
                throw error;
            }

            const meta = { url: this.url.href, mime: lookup(this.path) || 'application/octet-stream', size: stats.size, modified: stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (!handle || limit <= 0) {
                return;         // No need to read an empty file
            }

            this._src = handle.createReadStream({
                start: this.start,
                end: limit - 1
            });
        }
        finally {
            if (handle && !this._src) {
                handle?.close().catch(ignore);
            }
        }

        this._src.on('close', () => {

            this._src = undefined;
        });

        const finished = pump(this._src, this);

        let accum = 0;
        this._src.on('data', (chunk) => {

            accum += chunk.length;
        });

        try {
            await finished;

            if (accum !== bytes) {
                throw new Error('stream length did not match stats');
            }
        }
        catch (err) {
            // TODO: retry??
            throw Boom.internal('transmission error', err);
        }

        debug('done fetching uri', this.url.href);
    }
}

register('file', UriFileReader);
