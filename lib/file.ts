// RFC 1738 file: URI support

import type { Readable } from 'stream';
import type { Readable as RsReadable } from 'readable-stream';

import Fs = require('fs');
import { format, UrlObject } from 'url';
import { promisify } from 'util';

import * as Boom from '@hapi/boom';
import { ignore } from '@hapi/hoek';
import { lookup } from 'mime-types';
import Oncemore = require('oncemore');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const debug = require('debug')('uristream:file');

import { register } from './registry';
import { UriReader, SharedReaderOptions } from './uri-reader';


export type FileReaderOptions = SharedReaderOptions;


const PREFIX = 'file://';

const pump = function <S extends Readable, D extends (Readable | RsReadable)> (src: S, dst: D): Promise<void> {

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
    private _src?: Fs.ReadStream;

    readonly path: string;

    constructor(uri: string | UrlObject, options: FileReaderOptions = {}) {

        super(uri, options);

        if (this.url.href.slice(0,PREFIX.length) !== PREFIX) {
            throw Boom.badRequest('invalid uri prefix: ' + this.url.href);
        }

        if (!(this.url.host === '' || this.url.host === 'localhost')) {
            throw Boom.badRequest('only local file uri\' are supported: ' + this.url.href);
        }

        this.path = this.url.path!;

        if (this.timeout) {
            this._timeoutId = setTimeout(() => {

                this.destroy(Boom.gatewayTimeout());
            }, this.timeout);
        }

        this.process().catch(this.destroy.bind(this));
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _read(): void {}

    async process(): Promise<void> {

        const uri = format(this.url);
        let stats;
        let fd;
        let bytes: number;

        try {
            try {
                if (this.probe) {
                    stats = await promisify(Fs.stat)(this.path);
                }
                else {
                    fd = await promisify(Fs.open)(this.path, 'r');
                    stats = await promisify(Fs.fstat)(fd);
                }
            }
            catch (thrownErr) {
                let err = thrownErr;

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

            const meta = { url: uri, mime: lookup(this.path) || 'application/octet-stream', size: stats.size, modified: stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (fd === undefined) {
                this.push(null);
                return;
            }

            this._src = Fs.createReadStream(this.path, {
                fd,
                start: this.start,
                end: limit - 1
            });
        }
        catch (err) {
            if (fd !== undefined) {
                Fs.close(fd, ignore);
            }

            throw err;
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

        debug('done fetching uri', uri);

        this.push(null);
    }

    _destroy(err: Error | null, cb: (err: Error | null) => void): void {

        clearTimeout(this._timeoutId as NodeJS.Timeout);
        if (this._src) {
            this._src.destroy();
        }

        return super._destroy(err, cb);
    }
}

register('file', UriFileReader);
