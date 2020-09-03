'use strict';

const Http = require('http');
const Util = require('util');
const Zlib = require('zlib');

const Boom = require('@hapi/boom');
const Got = require('got');
const Hoek = require('@hapi/hoek');
const Oncemore = require('oncemore');
const debug = require('debug')('uristream:http');

const UriStream = require('../uristream');

const Pkg = require('../package');

const DEFAULT_AGENT = Util.format('%s/v%s got/v%s node.js/%s', Pkg.name, Pkg.version, require('got/package').version, process.version);

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

        if (limit === 0 && !src._readableState.ended) {
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
        const agent = options.agent instanceof Http.Agent ? { http: options.agent, https: options.agent } : options.agent || null;

        let tries = 1 + (+options.retries || 1);
        if (!this.probe) {
            defaults['accept-encoding'] = ['gzip', 'deflate', 'br'];
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

            // allow aborting the request
            this._destroy = (err, cb) => {

                if (req) {
                    tries = 0;
                    req.destroy();
                }

                return UriStream.UriReader.prototype._destroy.call(this, err, cb);
            };

            let failed = false;
            const failOrRetry = (err, permanent) => {

                if (failed) {
                    return;
                }

                failed = true;

                req.destroy();
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
            const req = Got.stream(uri, {
                method: fetchMethod,
                headers,
                agent,
                timeout: this.timeout,
                maxRedirects: 10,
                retry: 0, /* handled manually */
                decompress: false, /* handled manually */
                http2: true,
                throwHttpErrors: false
            });

            // forward any future errors to response stream
            req.on('error', (err) => this.destroy(err));

            req.on('response', (res) => {

                const isPermanent = (code) => {
                    // very conservative list of permanent response codes
                    return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
                };

                if (res.statusCode >= 400) {
                    return failOrRetry(new Boom.Boom(null, { statusCode: res.statusCode }), isPermanent(res.statusCode));
                }

                if (res.statusCode !== 200 && res.statusCode !== 204 && res.statusCode !== 206 && res.statusCode !== 304) {
                    return failOrRetry(new Boom.Boom(`Unhandled response code: ${res.statusCode}`), isPermanent(res.statusCode));
                }

                // handle servers that doesn't support range requests
                const cut = res.statusCode !== 206;
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
                else if (res.statusCode === 204) {
                    size = 0;
                }
                else if (res.headers['content-length']) {
                    size = parseInt(res.headers['content-length'], 10);
                }

                let filesize = (size >= 0) ? size : -1;

                // transparently handle compressed responses
                let stream = req;
                const decompressor = this._createDecompressor(res);
                if (decompressor) {
                    stream = stream.pipe(inheritErrors(decompressor));
                    filesize = -1;
                }

                // pipe it to self
                pump(stream, this, cut ? range : undefined, (err) => {

                    if (err || failed) {
                        return failOrRetry(err);
                    }

                    debug('done fetching uri', uri);

                    this.push(null);
                });

                // turn bad content-length into actual errors
                if (!this.probe && (size >= 0 || range.limit >= 0)) {
                    if (size >= 0) {
                        // 'downloadProgress' event cannot be used, since it is not emitted after 100%
                        req.on('data', () => {

                            const { transferred } = req.downloadProgress;
                            if (transferred > size) {
                                req.destroy();
                            }
                        });
                    }

                    Oncemore(req).once('end', 'error', (err) => {

                        let accumRaw = req.downloadProgress.transferred;
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

                const location = res.redirectUrls.length ? res.redirectUrls[res.redirectUrls.length - 1] : res.requestUrl;
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

    _createDecompressor(res) {

        if (res.headers['content-encoding'] === 'gzip' ||
            res.headers['content-encoding'] === 'deflate') {

            return Zlib.createUnzip();
        }

        if (res.headers['content-encoding'] === 'br') {
            return Zlib.createBrotliDecompress();
        }
    }
};

UriStream.register(['http', 'https'], UriHttpReader);

module.exports = exports = UriHttpReader;
