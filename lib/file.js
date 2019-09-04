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

const UriStream = require('../uristream');

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

const UriFileReader = class extends UriStream.UriReader {

    constructor(uri, options) {

        super(uri, options);

        if (uri.slice(0,PREFIX.length) !== PREFIX) {
            throw Boom.badRequest('invalid uri prefix: ' + uri);
        }

        if (!(this.url.host === '' || this.url.host === 'localhost')) {
            throw Boom.badRequest('only local file uri\' are supported: ' + uri);
        }

        this.path = this.url.path;

        this.process().catch((err) => {

            this.emit('error', err);
        });
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

            const limit = (this.end >= 0) ? Math.min(stats.size, this.end + 1) : stats.size;
            var bytes = limit - this.start;

            const meta = { url: uri, mime: Mime.lookup(this.path) || 'application/octet-stream', size: bytes, modified: stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (fd === undefined) {
                return this.push(null);
            }

            var src = Fs.createReadStream(this.path, {
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

        src.on('close', () => {

            this.closed = true;
            this.emit('close');
        });

        this.abort = (reason) => {

            if (!this.closed) {
                src.destroy();
            }
        };

        const finished = pump(src, this);

        let accum = 0;
        src.on('data', (chunk) => {

            accum += chunk.length;
            if (accum > bytes) {
                src.destroy();
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
};

UriStream.register('file', UriFileReader);

module.exports = exports = UriFileReader;
