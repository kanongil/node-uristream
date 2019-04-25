'use strict';

const Util = require('util');
const Zlib = require('zlib');

const Wreck = require('@hapi/wreck');
const Hoek = require('@hapi/hoek');
const Boom = require('@hapi/boom');
const Oncemore = require('oncemore');
const debug = require('debug')('uristream:http');

const UriStream = require('../uristream');

const Pkg = require('../package');

const DEFAULT_AGENT = Util.format('%s/v%s wreck/v%s node.js/%s', Pkg.name, Pkg.version, require('@hapi/wreck/package').version, process.version);

// forward errors emitted upstream
const inheritErrors = function (stream) {

    stream.on('pipe', (source) => {

        source.on('error', stream.emit.bind(stream, 'error'));
    });
    stream.on('unpipe', (source) => {

        source.removeListener('error', stream.emit.bind(stream, 'error'));
    });
    return stream;
};

// 'pipe' any stream to a Readable
const pump = function (src, dst, skipBytes, done) {

    dst.transferred = dst.transferred || 0;

    src.on('data', (chunk) => {

        if (skipBytes !== 0) {
            skipBytes -= chunk.length;
            if (skipBytes >= 0) {
                return;
            }

            chunk = chunk.slice(skipBytes);
            skipBytes = 0;
        }

        dst.transferred += chunk.length;
        if (!dst.push(chunk)) {
            src.pause();
        }
    });
    Oncemore(src).once('end', 'error', (err) => {
    // TODO: flush source buffer on error?
        dst._read = Hoek.ignore;
        done(err);
    });
    dst._read = (n) => {

        src.resume();
    };
};

const UriHttpReader = function (uri, options) {

    options = options || {};

    UriStream.UriReader.call(this, uri, options);

    this.transferred = 0;

    const defaults = {
        'user-agent': DEFAULT_AGENT
    };

    const offset = this.start;
    const agent = options.agent || null;

    let tries = 1 + (+options.retries || 1);
    if (!this.probe) {
        defaults['accept-encoding'] = ['gzip', 'deflate'];
    }

    const fetchMethod = this.probe ? 'HEAD' : 'GET';

    // TODO: handle case in header names
    const headers = Hoek.applyToDefaults(defaults, options.headers || {}, true);
    if ('range' in headers) {
        throw Boom.badRequest('Range header is not allowed - use start and end options');
    }

    // attach empty 'error' listener to keep from ever throwing
    this.on('error', Hoek.ignore);

    const fetchHttp = (start) => {

        if (start > 0 || this.end >= 0) {
            headers.range = 'bytes=' + start + '-' + (this.end >= 0 ? this.end : '');
            // content-encoding + range is very ambigous, so disable encoding
            delete headers['accept-encoding'];
        }

        let location = uri;

        const onRedirect = (statusCode, newLocation, newReq) => {

            location = newLocation;
            req = newReq;
        };

        // allow aborting the request
        this.abort = (reason) => {

            if (!this.closed) {
                tries = 0;
                req.abort();
            }
        };

        let failed = false;
        const failOrRetry = (err, permanent) => {

            if (failed) {
                return;
            }

            failed = true;

            req.abort();
            if (--tries <= 0 || permanent) {
                // remap error to partial error if we have received any data
                if (this.transferred !== 0) {
                    err = new UriStream.PartialError(err, this.transferred, (size !== -1) ? start - offset + size : size);
                }

                return this.emit('error', err);
            }

            debug('retrying at ' + (offset + this.transferred));

            // TODO: delay retry?
            fetchHttp(offset + this.transferred);
        };

        let size = -1;
        const promise = Wreck.request(fetchMethod, uri, { headers, agent, timeout: this.timeout, redirects: 10, redirected: onRedirect });
        let { req } = promise;

        promise.then((res) => {

            const isPermanent = (code) => {
                // very conservative list of permanent response codes
                return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
            };

            if (res.statusCode !== 200 && res.statusCode !== 206) {
                return failOrRetry(new Boom(null, { statusCode: res.statusCode }), isPermanent(res.statusCode));
            }

            // handle servers that doesn't support range requests
            const skip = (res.statusCode === 200) ? start : 0;
            if (skip) {
                debug('skipping ' + skip + ' initial bytes');
            }

            if (res.headers['content-length']) {
                size = parseInt(res.headers['content-length'], 10);
            }

            let filesize = (size >= 0) ? start + size - skip - offset : -1;

            // transparently handle gzip responses
            let stream = res;
            if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'deflate') {
                const unzip = Zlib.createUnzip();
                stream = stream.pipe(inheritErrors(unzip));
                filesize = -1;
            }

            // pipe it to self
            pump(stream, this, skip, (err) => {

                if (err || failed) {
                    return failOrRetry(err);
                }

                debug('done fetching uri', uri);
                this.push(null);

                this.closed = true;
                this.emit('close');
            });

            // forward any future errors to response stream
            req.on('error', (err) => {

                this.emit('error', err);
            });

            // turn bad content-length into actual errors
            if (size >= 0 && !this.probe) {
                let accumRaw = 0;

                res.on('data', (chunk) => {

                    accumRaw += chunk.length;
                    if (accumRaw > size) {
                        req.abort();
                    }
                });

                Oncemore(res).once('end', 'error', (err) => {

                    if (!err && accumRaw !== size) {
                        failOrRetry(Boom.badImplementation('Stream length did not match header'));
                    }
                });
            }

            // extract meta information from header
            const typeparts = /^(.+?\/.+?)(?:;\w*.*)?$/.exec(res.headers['content-type']) || [null, 'application/octet-stream'];
            const mimetype = typeparts[1].toLowerCase();
            const modified = res.headers['last-modified'] ? new Date(res.headers['last-modified']) : null;

            const meta = { url: location, mime: mimetype, size: filesize, modified };
            if (this.meta) {
                // ignore change from unknown to know size
                if (this.meta.size === -1) {
                    meta.size = this.meta.size;
                }

                if (!Hoek.deepEqual(this.meta, meta)) {
                    tries = 0;
                    failOrRetry(Boom.conflict('file has changed'));
                }
            }
            else {
                this.meta = meta;
                this.emit('meta', this.meta);
            }
        }, failOrRetry);
    };

    fetchHttp(offset);
};

Util.inherits(UriHttpReader, UriStream.UriReader);

UriStream.register(['http', 'https'], UriHttpReader);

module.exports = exports = UriHttpReader;
