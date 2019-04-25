'use strict';

// RFC 1738 file: URI support

const Mime = require('mime-types');
const Fs = require('fs');

const Boom = require('@hapi/boom');
const Oncemore = require('oncemore');
const debug = require('debug')('uristream:file');

const UriStream = require('../uristream');

const PREFIX = 'file://';

const noop = function () {};

const pump = function (src, dst, done) {

    src.on('data', (chunk) => {

        if (!dst.push(chunk)) {
            src.pause();
        }
    });
    Oncemore(src).once('end', 'error', (err) => {
    // TODO: flush source buffer on error?
        dst._read = noop;
        done(err);
    });
    dst._read = (n) => {

        src.resume();
    };
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

        Fs.stat(this.path, (err, stats) => {

            if (err) {
                if (err.code === 'ENOENT') {
                    err = Boom.notFound('no such file');
                }
                else if (err.code === 'EACCES') {
                    err = Boom.forbidden('permission error');
                }
                else {
                    err = Boom.badImplementation('unknown access error: ' + err.code, err);
                }

                return this.emit('error', err);
            }

            if (stats.isDirectory()) {
                return this.emit('error', Boom.forbidden('directory listing is not allowed'));
            }

            const limit = (this.end >= 0) ? Math.min(stats.size, this.end + 1) : stats.size;
            const bytes = limit - this.start;

            const meta = { url:uri, mime:Mime.lookup(this.path) || 'application/octet-stream', size:bytes, modified:stats.mtime };
            this.meta = meta;
            this.emit('meta', this.meta);

            if (this.probe) {
                return this.push(null);
            }

            const src = Oncemore(Fs.createReadStream(this.path, {
                start: this.start,
                end: this.end
            }));

            src.on('close', () => {

                this.closed = true;
                this.emit('close');
            });

            this.abort = (reason) => {

                if (!this.closed) {
                    src.destroy();
                }
            };

            pump(src, this, (err) => {

                if (!err && accum !== bytes) {
                    err = new Error('stream length did not match stats');
                }

                if (err) {
                    return this.emit('error', Boom.badImplementation('transmission error', err));
                }

                debug('done fetching uri', uri);
                this.push(null);
            });

            let accum = 0;
            src.on('data', (chunk) => {

                accum += chunk.length;
                if (accum > bytes) {
                    src.destroy();
                }
            });
        });
    }

    _read() {}
};

UriStream.register('file', UriFileReader);

module.exports = exports = UriFileReader;
