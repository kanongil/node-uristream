import type { Socket } from 'node:net';
import type { Readable, Transform, Writable } from 'node:stream';

import { Agent as HttpAgent, IncomingMessage } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { format } from 'node:util';
import { createBrotliDecompress, createUnzip } from 'node:zlib';

import { Boom, badRequest, badImplementation, conflict, boomify, rangeNotSatisfiable } from '@hapi/boom';
import Got, { Agents } from 'got';
import { applyToDefaults, ignore } from '@hapi/hoek';
import Keepalive from 'agentkeepalive';
import Oncemore from 'oncemore';
import { default as Debug } from 'debug';
const debug = Debug('uristream:http');

import { PartialError } from './partial-error.js';
import { register } from './registry.js';
import { UriReader, SharedReaderOptions } from './uri-reader.js';
import * as Versions from './versions.js';


const internals = {
    defaultAgent: format('%s/v%s got/v%s node.js/%s', Versions.name, Versions.module, Versions.got, process.version),

    // forward errors emitted upstream
    inheritErrors<T extends Writable>(stream: T): T {

        const onError = (err: Error) => {

            stream.destroy(err);
        };

        stream.on('pipe', (source) => source.on('error', onError));
        stream.on('unpipe', (source) => source.removeListener('error', onError));

        return stream;
    },

    // 'pipe' any stream to a Readable
    pump(src: Readable, dst: Readable & { transferred?: number }, { skip = 0, limit = -1 } = {}, done: (err?: Error) => void) {

        dst.transferred = dst.transferred || 0;

        src.on('data', (chunk: Buffer) => {

            if (skip !== 0) {
                skip -= chunk.length;
                if (skip >= 0) {
                    return;
                }

                chunk = chunk.subarray(skip);
                skip = 0;
            }

            if (limit >= 0) {
                if (chunk.length < limit) {
                    limit -= chunk.length;
                }
                else {
                    chunk = chunk.subarray(0, limit);
                    limit = 0;
                }
            }

            dst.transferred! += chunk.length;
            if (!dst.push(chunk)) {
                src.pause();
            }

            if (limit === 0 && !src.readableEnded) {
                src.destroy();
            }
        });
        Oncemore(src).once('close', 'end', 'error', (err) => {
            // TODO: flush source buffer on error?
            dst._read = ignore;
            done(err);
        });
        dst._read = (n: number) => {

            src.resume();
        };
    },

    agents(): Agents {

        if (!internals._agents) {
            const config = {
                maxSockets: 6,
                maxFreeSockets: 6,
                timeout: 0, // disable socket inactivity timeout
                freeSocketTimeout: 60000, // free unused sockets after 60 seconds
            };

            internals._agents = {
                http: new Keepalive(config),
                https: new Keepalive.HttpsAgent(config)
            };
        }

        return internals._agents;
    },
    _agents: undefined as unknown as Agents
};


export type HttpReaderOptions = SharedReaderOptions & {
    /** Amount of possible retries (HTTP-only) */
    retries?: number;
    /** Extra headers for request (HTTP-only) */
    headers?: Record<string, string | string[]>;
    /** Custom Agent(s) (HTTP-only) */
    agent?: Agents | typeof HttpAgent;
    /** Set to handle [unix socket urls](https://github.com/sindresorhus/got/blob/v14.0.0/documentation/2-options.md#enableunixsockets). */
    enableUnixSockets?: boolean;
};


export class UriHttpReader extends UriReader {

    transferred = 0;

    constructor(uri: URL, options: HttpReaderOptions = {}) {

        super(uri, { ...options });

        const defaults: Record<string, string | string[]> = {
            'user-agent': internals.defaultAgent
        };

        const offset = this.start;
        const agent = options.agent instanceof HttpAgent ? {
            http: options.agent as HttpAgent,
            https: options.agent as HttpsAgent
        } : options.agent as Agents || internals.agents();

        let tries = 1 + (options.retries ?? 1);
        if (!this.probe) {
            defaults['accept-encoding'] = ['gzip', 'deflate', 'br'];
        }

        const fetchMethod = this.probe ? 'HEAD' : 'GET';
        const enableUnixSockets = !!options.enableUnixSockets;

        // TODO: handle case in header names
        const headers = applyToDefaults(defaults, options.headers || {}, { nullOverride: true });
        if ('range' in headers) {
            throw badRequest('Range header is not allowed - use start and end options');
        }

        // attach empty 'error' listener to keep from ever throwing
        this.on('error', ignore);

        const fetchHttp = (start: number): void => {

            if ((start > 0 || this.end! >= 0) &&
                !this.meta?.etag?.startsWith('W/')) {

                headers.range = 'bytes=' + start + '-' + (this.end! >= 0 ? this.end : '');
                // content-encoding + range is very ambigous, so disable encoding
                delete headers['accept-encoding'];
            }

            // allow aborting the request
            this._destroy = (err, cb) => {

                if (req) {
                    tries = 0;
                    req.destroy();
                }

                return UriReader.prototype._destroy.call(this, err, cb);
            };

            let failed = false;
            const failOrRetry = (err: Error, permanent = false) => {

                if (failed) {
                    return;
                }

                failed = true;

                req.destroy();
                if (--tries <= 0 || permanent) {
                    if (!(err instanceof Boom)) {
                        boomify(err);
                    }

                    // remap error to partial error if we have received any data
                    if (this.transferred !== 0) {
                        err = new PartialError(err, this.transferred, (contentLength !== -1) ? contentLength - offset : contentLength);   // TODO: handle this.end!!
                    }

                    return this._fetched(err);
                }

                debug('retrying at ' + (offset + this.transferred));

                // TODO: delay retry?
                fetchHttp(offset + this.transferred);
            };

            let contentLength = -1;
            const req = Got.stream(this.url.href, {
                method: fetchMethod,
                headers,
                agent,
                timeout: {
                    request: this.timeout   // TODO: reduce timeout for retries
                },
                maxRedirects: 10,
                retry: { limit: 0 }, /* handled manually */
                decompress: false, /* handled manually */
                http2: agent.http2 ? true : false,
                throwHttpErrors: false,
                enableUnixSockets
            });

            // Set no delay on socket

            req.on('socket', (connection: Socket) => {

                try {
                    connection.setNoDelay(true);
                }
                catch (err) {
                    // HTTP/2 sockets already use noDelay, and throw when called directly on socket.
                }
            });

            req.on('error', failOrRetry);

            req.on('response', (res: IncomingMessage) => {

                const isPermanent = (code: number) => {
                    // very conservative list of permanent response codes
                    return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
                };

                if (res.statusCode! >= 400) {
                    return failOrRetry(new Boom(undefined, { statusCode: res.statusCode }), isPermanent(res.statusCode!));
                }

                if (res.statusCode !== 200 && res.statusCode !== 204 && res.statusCode !== 206 && res.statusCode !== 304) {
                    return failOrRetry(new Boom(`Unhandled response code: ${res.statusCode}`), isPermanent(res.statusCode!));
                }

                // handle servers that doesn't support range requests
                const cut = res.statusCode !== 206;
                const range = {
                    skip: start,
                    limit: this.end! >= 0 ? this.end! + 1 - start : -1
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
                    // We assume that the requested range is returned (up to content-length - 1)
                    const match = /bytes.+\/(\d+)/.exec(res.headers['content-range']!);
                    if (match) {
                        contentLength = parseInt(match[1], 10);
                    }
                }
                else if (res.statusCode === 204) {
                    contentLength = 0;
                }
                else if (res.headers['content-length']) {
                    contentLength = parseInt(res.headers['content-length'], 10);
                }

                let target = contentLength - range.skip;
                if (range.limit >= 0) {
                    target = Math.min(range.limit, target);
                }

                if (contentLength >= 0 && target < 0) {
                    const error = rangeNotSatisfiable();
                    (error.output.headers as { [name: string]: string })['content-range'] = 'bytes */' + contentLength;
                    return this._fetched(error);
                }

                let filesize = contentLength;

                if (this.probe) {
                    debug('done probing uri', uri.href);

                    if (res.headers['content-encoding'] &&
                        res.headers['content-encoding'] !== 'identity') {
                        filesize = -1;
                    }

                    req.resume();      // Ensure buffer empties
                    failed = true;     // Disable failOrRetry handler 
                    this._fetched();
                }
                else {

                    // Transparently handle compressed responses

                    let stream: Readable = req;
                    const decompressor = this._createDecompressor(res);
                    if (decompressor) {
                        stream = stream.pipe(internals.inheritErrors(decompressor));

                        // For compressed entities we don't know the decompressed size

                        filesize = -1;
                    }

                    // Turn bad content-length into actual errors

                    if (contentLength >= 0 || range.limit >= 0) {
                        if (contentLength >= 0) {
                            // 'downloadProgress' event cannot be used, since it is not emitted after 100%
                            req.on('data', () => {

                                const { transferred } = req.downloadProgress;
                                if (transferred > contentLength) {
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


                            if (!err && accumRaw !== target) {
                                req.destroy(badImplementation('Stream length did not match header'));
                            }
                        });
                    }

                    // Pipe it to self - MUST BE AFTER PREVIOUS SECTION TO CATCH SIZE ERRORS!!

                    internals.pump(stream, this, cut ? range : undefined, (err) => {

                        if (err || failed) {
                            return failOrRetry(err || new Error('already failed'));
                        }

                        debug('done fetching uri', uri.href);

                        this._fetched();
                    });
                }

                // extract meta information from header
                const typeparts = /^(.+?\/.+?)(?:;\w*.*)?$/.exec(res.headers['content-type']!) || [null, 'application/octet-stream'];
                const mimetype = typeparts[1]!.toLowerCase();
                const modified = res.headers['last-modified'] ? new Date(res.headers['last-modified']) : null;
                const etag = res.headers.etag as string | undefined;

                const location = res.url || this.url.href;
                const meta = { url: location, mime: mimetype, size: filesize, modified, etag };
                if (this.meta) {
                    // ignore change from unknown to know size
                    if (this.meta.size === -1) {
                        meta.size = this.meta.size;
                    }

                    if (this.meta.url !== meta.url ||
                        this.meta.mime !== meta.mime ||
                        this.meta.size !== meta.size ||
                        +this.meta.modified! !== +meta.modified! ||
                        this.meta.etag !== meta.etag) {

                        failOrRetry(conflict('file has changed'), true);
                    }
                }
                else {
                    this.meta = meta;
                    this.emit('meta', this.meta);
                }
            });
        };

        fetchHttp(offset);
    }

    _createDecompressor(res: IncomingMessage): Transform | undefined {

        if (res.headers['content-encoding'] === 'gzip' ||
            res.headers['content-encoding'] === 'deflate') {

            return createUnzip();
        }

        if (res.headers['content-encoding'] === 'br') {
            return createBrotliDecompress();
        }
    }
}

register(['http', 'https'], UriHttpReader);
