'use strict';

// RFC 1738 file: URI support

const Util = require('util');

const Mime = require('mime-types');
const Fs = require('fs');

const Boom = require('boom');
const Pati = require('pati');
const debug = require('debug')('uristream:file');

const UriStream = require('../uristream');

const PREFIX = 'file://';


const internals = {
    noop: function () {},
    fsStat: Util.promisify(Fs.stat)
};


const UriFileReader = class extends UriStream.UriReader {

    constructor(uri, options) {

        super(uri, options);

        if (uri.slice(0, PREFIX.length) !== PREFIX) {
            throw Boom.badRequest('invalid uri prefix: ' + uri);
        }

        if (!(this.url.host === '' || this.url.host === 'localhost')) {
            throw Boom.badRequest('only local file uri\' are supported: ' + uri);
        }

        this.path = this.url.path;

        this.process(uri);

        return this;
    }

    async process(uri) {

        try {
            let stats;
            try {
                stats = await internals.fsStat(this.path);
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    throw Boom.notFound('no such file');
                }
                else if (err.code === 'EACCES') {
                    throw Boom.forbidden('permission error');
                }
                else {
                    throw Boom.badImplementation('unknown access error: ' + err.code, err);
                }
            }

            if (stats.isDirectory()) {
                throw Boom.forbidden('directory listing is not allowed');
            }

            const limit = (this.end >= 0) ? Math.min(stats.size, this.end + 1) : stats.size;
            const bytes = limit - this.start;

            const meta = { url: uri, mime: Mime.lookup(this.path) || 'application/octet-stream', size: bytes, modified: stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (this.probe) {
                return this.push(null);
            }

            const src = Fs.createReadStream(this.path, {
                start: this.start,
                end: this.end
            });

            src.on('error', internals.noop);
            src.on('close', () => {

                this.closed = true;
                this.emit('close');
            });

            const dispatcher = new Pati.EventDispatcher(src);

            if (this.timeout) {
                dispatcher.adopt(new Pati.TimeoutDispatcher(this.timeout, Boom.gatewayTimeout()));
            }

            dispatcher.on('end', Pati.EventDispatcher.end);

            this.abort = (reason) => {

                dispatcher.cancel(reason || new Error('user abort'));
                if (!this.closed) {
                    src.destroy();
                }
            };

            let accum = 0;

            dispatcher.on('data', (chunk) => {

                accum += chunk.length;
                if (accum > bytes) {
                    throw new Error('too much data');
                }

                if (!this.push(chunk)) {
                    src.pause();
                }
            });

            this._read = (n) => {

                // TODO: ignore after finish
                src.resume();
            };

            try {
                await dispatcher.finish();
                if (accum !== bytes) {
                    throw new Error('stream length did not match stats');
                }
            }
            catch (err) {
                src.destroy(err);
                if (!err.isBoom) {
                    throw Boom.badImplementation('transmission error', err);
                }
                throw err;
            }

            debug('done fetching uri', uri);
            this.push(null);
        }
        catch (err) {
            return this.emit('error', err);
        }
    }

    _read(n) { }
};


UriStream.register('file', UriFileReader);


module.exports = exports = UriFileReader;
