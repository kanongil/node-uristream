'use strict';

const Util = require('util');
const Zlib = require('zlib');

const Boom = require('@hapi/boom');
const Hoek = require('@hapi/hoek');
const Oncemore = require('oncemore');
const Wreck = require('@hapi/wreck');
const debug = require('debug')('uristream:http');

const UriStream = require('../uristream');

const Pkg = require('../package');

const DEFAULT_AGENT = Util.format('%s/v%s wreck/v%s node.js/%s', Pkg.name, Pkg.version, require('@hapi/wreck/package').version, process.version);

// forward errors emitted upstream
const inheritErrors = function (stream) {

    const onError = (err) => {

        stream.destroy(err);
    };

    stream.on('pipe', (source) => source.on('error', onError));
    stream.on('unpipe', (source) => source.removeListener('error', onError));

    return stream;
};

// 'pipe' any stream to a Readable
const pump = function (src, dst, { skip = 0, limit = -1 } = {}, done) {

    dst.transferred = dst.transferred || 0;

    src.on('data', (chunk) => {

        if (skip !== 0) {
            skip -= chunk.length;
            if (skip >= 0) {
                return;
            }

            chunk = chunk.slice(skip);
            skip = 0;
        }

        if (limit >= 0) {
            if (chunk.length < limit) {
                limit -= chunk.length;
            }
            else {
                chunk = chunk.slice(0, limit);
                limit = 0;
            }
        }

        dst.transferred += chunk.length;
        if (!dst.push(chunk)) {
            src.pause();
        }

        if (limit === 0) {
            src.destroy();
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

const UriHttpReader = class extends UriStream.UriReader {

    constructor(uri, options = {}) {

        super(uri, { ...options, emitClose: true });

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
        const headers = Hoek.applyToDefaults(defaults, options.headers || {}, { nullOverride: true });
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
            this._destroy = (err, cb) => {

                if (req && !req.destroyed) {
                    tries = 0;
                    req.abort();
                }

                return UriStream.UriReader.prototype._destroy.call(this, err, cb);
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

                    return this.destroy(err);
                }

                debug('retrying at ' + (offset + this.transferred));

                // TODO: delay retry?
                fetchHttp(offset + this.transferred);
            };

            let size = -1;
            const promise = Wreck.request(fetchMethod, uri, { headers, agent, timeout: this.timeout, redirects: 10, redirected: onRedirect });
            let { req } = promise;

            promise.then((res) => {

                console.log('!', res.headers)
                const isPermanent = (code) => {
                    // very conservative list of permanent response codes
                    return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
                };

                if (res.statusCode !== 200 && res.statusCode !== 206 && res.statusCode !== 304) {
                    return failOrRetry(new Boom.Boom(null, { statusCode: res.statusCode }), isPermanent(res.statusCode));
                }

                // handle servers that doesn't support range requests
                const cut = res.statusCode === 200;
                const range = {
                    skip: start,
                    limit: this.end >= 0 ? this.end + 1 - start : -1
                };

                if (cut) {
                    if (range.skip) {
                        debug('skipping ' + range.skip + ' initial bytes');
                    }

                    if (range.limit >= 0) {
                        debug('limit to ' + range.limit + '  bytes');
                    }
                }

                if (res.statusCode === 206) {
                    // We assume that the full requested range is returned
                    const match = /bytes.+\/(\d+)/.exec(res.headers['content-range']);
                    if (match) {
                        size = parseInt(match[1], 10);
                    }
                }
                else if (res.headers['content-length']) {
                    size = parseInt(res.headers['content-length'], 10);
                }

                let filesize = (size >= 0) ? size : -1;

                // transparently handle gzip responses
                let stream = res;
                if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'deflate') {
                    const unzip = Zlib.createUnzip();
                    stream = stream.pipe(inheritErrors(unzip));
                    filesize = -1;
                }

                // pipe it to self
                pump(stream, this, cut ? range : undefined, (err) => {

                    if (err || failed) {
                        return failOrRetry(err);
                    }

                    debug('done fetching uri', uri);

                    this.push(null);
                    this.destroy();
                });

                // forward any future errors to response stream
                req.on('error', (err) => this.destroy(err));

                // turn bad content-length into actual errors
                if (!this.probe && (size >= 0 || range.limit >= 0)) {
                    let accumRaw = 0;

                    res.on('data', (chunk) => {

                        accumRaw += chunk.length;
                        if (size >= 0 && accumRaw > size) {
                            req.abort();
                        }
                    });

                    Oncemore(res).once('end', 'error', (err) => {

                        if (cut) {
                            // Trim to match
                            accumRaw -= range.skip;

                            if (range.limit >= 0) {
                                accumRaw = Math.min(accumRaw, range.limit);
                            }
                        }

                        const target = range.limit >= 0 ? range.limit : size - range.skip;

                        if (!err && accumRaw !== target) {
                            failOrRetry(Boom.badImplementation('Stream length did not match header'));
                        }
                    });
                }

                // extract meta information from header
                const typeparts = /^(.+?\/.+?)(?:;\w*.*)?$/.exec(res.headers['content-type']) || [null, 'application/octet-stream'];
                const mimetype = typeparts[1].toLowerCase();
                const modified = res.headers['last-modified'] ? new Date(res.headers['last-modified']) : null;
                const etag = res.headers.etag;

                const meta = { url: location, mime: mimetype, size: filesize, modified, etag };
                if (this.meta) {
                    // ignore change from unknown to know size
                    if (this.meta.size === -1) {
                        meta.size = this.meta.size;
                    }

                    if (!Hoek.deepEqual(this.meta, meta, { symbols: false })) {
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
    }
};

UriStream.register(['http', 'https'], UriHttpReader);

module.exports = exports = UriHttpReader;
