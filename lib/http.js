'use strict';

const Util = require('util');
const Zlib = require('zlib');

const Boom = require('boom');
const Hoek = require('hoek');
const Pati = require('pati');
const Wreck = require('wreck');
const debug = require('debug')('uristream:http');

const UriStream = require('../uristream');

const Pkg = require('../package');
const DEFAULT_AGENT = Util.format('%s/v%s wreck/v%s node.js/%s', Pkg.name, Pkg.version, require('wreck/package').version, process.version);


const internals = {};


// forward errors emitted upstream
internals.inheritErrors = function (stream) {

    stream.on('pipe', (source) => {

        source.on('error', stream.emit.bind(stream, 'error'));
    });
    stream.on('unpipe', (source) => {

        source.removeListener('error', stream.emit.bind(stream, 'error'));
    });
    return stream;
};


internals.createReqDispatcher = (req) => {

    const cleanup = function () {

        if (!this.aborted && (this.res && !this.res.finished)) {
            this.abort();
        }

        this.destroy();
    };

    const dispatcher = new Pati.EventDispatcher(req, { cleanup });
    dispatcher.on('aborted', () => dispatcher.cancel(new Error('aborted by upstream')));

    return dispatcher;
};


const UriHttpReader = class extends UriStream.UriReader {

    constructor(uri, options) {

        options = options || {};

        super(uri, options);

        this.transferred = 0;

        this.process(uri, options);

        return this;
    }

    async process(uri, options) {

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
        this.on('error', Hoek.ignore); // TODO: remove

        const prepareDispatcher = async (start) => {

            if (start > 0 || this.end >= 0) {
                headers.range = 'bytes=' + start + '-' + (this.end >= 0 ? this.end : '');
                // content-encoding + range is very ambigous, so disable encoding
                delete headers['accept-encoding'];
            }

            // allow aborting the request
            this.abort = (reason) => {

                if (!this.closed) {
                    tries = 0;
                    req.cancel(reason || new Error('user abort'));
                }
            };

            let location = uri;

            const onRedirect = (statusCode, newLocation, newReq) => {

                location = newLocation;
                req.end();
                req.finish();
                req = internals.createReqDispatcher(newReq);
            };

            const promise = Wreck.request(fetchMethod, uri, { headers, agent, timeout: this.timeout, redirects: 10, redirected: onRedirect });
            let req = internals.createReqDispatcher(promise.req);      // req changes if redirected

            const res = new Pati.EventDispatcher(await promise);

            return { location, dispatcher: res.adopt(req) };
        };

        const processResponse = async (start, location, dispatcher) => {

            const res = dispatcher.source;
            if (res.statusCode !== 200 && res.statusCode !== 206) {
                throw Boom.create(res.statusCode);
            }

            // Handle servers that doesn't support range requests

            const skip = (res.statusCode === 200) ? start : 0;
            if (skip) {
                debug('skipping ' + skip + ' initial bytes');
            }

            let size = -1;
            if (res.headers['content-length']) {
                size = parseInt(res.headers['content-length'], 10);
            }
            let filesize = (size >= 0) ? start + size - skip - offset : -1;

            // Transparently handle gzip responses

            if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'deflate') {
                const unzip = Zlib.createUnzip();
                const unzipDispatcher = new Pati.EventDispatcher(unzip, { cleanup: unzip.destroy, keepErrorListener: true });
                dispatcher = unzipDispatcher.adopt(dispatcher);
                res.pipe(unzip);
                delete res.headers['content-encoding'];
                filesize = -1;
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
                    throw Boom.conflict('file has changed');
                }
            }
            else {
                this.meta = meta;
                this.emit('meta', this.meta);
            }

            return { skip, dispatcher };
        };

        const pump = async (skipBytes, dispatcher) => {

            this.transferred = this.transferred || 0;

            dispatcher.on('data', (chunk) => {

                if (skipBytes !== 0) {
                    skipBytes -= chunk.length;
                    if (skipBytes >= 0) {
                        return;
                    }

                    chunk = chunk.slice(skipBytes);
                    skipBytes = 0;
                }

                this.transferred += chunk.length;
                if (!this.push(chunk)) {
                    dispatcher.source.pause();
                }
            });

            dispatcher.on('end', Pati.EventDispatcher.end);

            this._read = (n) => {

                dispatcher.source.resume();
            };

            try {
                await dispatcher.finish();
                debug('done fetching uri', uri);
                this.push(null);

                this.closed = true;
                this.emit('close');
            }
            catch (err) {
                throw err;
            }
        };

        const fetchHttp = async (start) => {

            try {
                const { location, dispatcher } = await prepareDispatcher(start);

                const { dispatcher: pumpDispatcher, skip } = await processResponse(start, location, dispatcher);
                await pump(skip, pumpDispatcher);
            }
            catch (err) {
                const isPermanent = (code) => {
                    // Very conservative list of permanent response codes

                    return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
                };

                const permanent = err.isBoom && isPermanent(err.output.statusCode);

                if (--tries <= 0 || permanent) {
                    // remap error to partial error if we have received any data
                    if (this.transferred !== 0) {
                        const size = this.meta.size;
                        throw new UriStream.PartialError(err, this.transferred, (size !== -1) ? start - offset + size : size);
                    }

                    throw err;
                }

                debug('retrying at ' + (offset + this.transferred));

                // TODO: delay retry?
                return await fetchHttp(offset + this.transferred);
            }
        };

        try {
            await fetchHttp(offset);
        }
        catch (err) {
            return this.emit('error', err);
        }
    }
};


UriStream.register(['http', 'https'], UriHttpReader);


module.exports = exports = UriHttpReader;
