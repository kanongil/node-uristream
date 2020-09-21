'use strict';

// RFC 1738 file: URI support

const Mime = require('mime-types');
const Fs = require('fs');
const Url = require('url');
const Util = require('util');

const Boom = require('@hapi/boom');
const Hoek = require('@hapi/hoek');
const Oncemore = require('oncemore');
const debug = require('debug')('uristream:file');

const { register } = require('./registry');
const { UriReader } = require('./uri-reader');


const PREFIX = 'file://';

const noop = function () {};

const pump = function (src, dst) {

    return new Promise((resolve, reject) => {

        src.on('data', (chunk) => {

            if (!dst.push(chunk)) {
                src.pause();
            }
        });

        Oncemore(src).once('end', 'error', (err) => {
            // TODO: flush source buffer on error?
            dst._read = noop;

            err ? reject(err) : resolve();
        });

        dst._read = (n) => {

            src.resume();
        };
    });
};

const UriFileReader = class extends UriReader {

    constructor(uri, options = {}) {

        super(uri, options);

        if (uri.slice(0,PREFIX.length) !== PREFIX) {
            throw Boom.badRequest('invalid uri prefix: ' + uri);
        }

        if (!(this.url.host === '' || this.url.host === 'localhost')) {
            throw Boom.badRequest('only local file uri\' are supported: ' + uri);
        }

        this.path = this.url.path;

        this._timeoutId = null;
        if (this.timeout) {
            this._timeoutId = setTimeout(() => {

                this.destroy(Boom.gatewayTimeout());
            }, this.timeout);
        }

        this.process().catch(this.destroy.bind(this));
    }

    _read() {}

    async process() {

        const uri = Url.format(this.url);
        let stats;
        let fd;

        try {
            try {
                if (this.probe) {
                    stats = await Util.promisify(Fs.stat)(this.path);
                }
                else {
                    fd = await Util.promisify(Fs.open)(this.path);
                    stats = await Util.promisify(Fs.fstat)(fd);
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

            const limit = (this.end >= 0) ? this.end + 1 : stats.size;
            var bytes = limit - this.start;

            if (limit > stats.size || bytes < 0) {
                throw Boom.rangeNotSatisfiable();
            }

            const meta = { url: uri, mime: Mime.lookup(this.path) || 'application/octet-stream', size: stats.size, modified: stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (fd === undefined) {
                this.push(null);
                return;
            }

            this._src = Fs.createReadStream(this.path, {
                fd,
                start: this.start,
                end: this.end
            });
        }
        catch (err) {
            if (fd !== undefined) {
                Fs.close(fd, Hoek.ignore);
            }

            throw err;
        }

        this._src.on('close', () => {

            this._src = null;
        });

        const finished = pump(this._src, this);

        let accum = 0;
        this._src.on('data', (chunk) => {

            accum += chunk.length;
            if (accum > bytes && this._src) {
                this._src.destroy();
            }
        });

        try {
            await finished;

            if (accum !== bytes) {
                throw new Error('stream length did not match stats');
            }
        }
        catch (err) {
            // TODO: retry??
            throw Boom.badImplementation('transmission error', err);
        }

        debug('done fetching uri', uri);

        this.push(null);
    }

    _destroy(err, cb) {

        clearTimeout(this._timeoutId);
        if (this._src) {
            this._src.destroy();
        }

        return super._destroy(err, cb);
    }
};

register('file', UriFileReader);

module.exports = exports = UriFileReader;
