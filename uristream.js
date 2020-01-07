'use strict';

const Url = require('url');
const { Readable } = require('readable-stream');

const Boom = require('@hapi/boom');

const UriReader = class extends Readable {

    constructor(uri, { highWaterMark, autoDestroy = false, emitClose = true, ...options }) {

        options = options || {};

        super({ highWaterMark, autoDestroy, emitClose });

        this.url = Url.parse(uri);
        this.meta = null;

        // options
        this.timeout = options.timeout;
        this.probe = !!options.probe;
        this.start = ~~options.start;
        // eslint-disable-next-line eqeqeq
        this.end = (parseInt(options.end, 10) == options.end) ? ~~options.end : undefined;

        // TODO: allow piping directly to a http response, like in request
    }

    _read() {}
};

const handlers = {};

const uristream = function (uri, options) {

    options = options || {};

    const protocol = Url.parse(uri).protocol || '';
    if (!protocol) {
        throw Boom.badRequest('Missing protocol in uri:', uri);
    }

    if (!isSupported(protocol)) {
        throw Boom.badRequest('Unsupported protocol:', protocol);
    }

    const scheme = protocol.slice(0,-1);
    if (options.whitelist && options.whitelist.indexOf(scheme) === -1) {
        throw Boom.forbidden('Protocol not allowed:', protocol);
    }

    if (options.blacklist && options.blacklist.indexOf(scheme) !== -1) {
        throw Boom.forbidden('Protocol not allowed:', protocol);
    }

    return new handlers[scheme](uri, options);
};

const register = function (schemes, handler) {

    if (!Array.isArray(schemes)) {
        schemes = [schemes];
    }

    schemes.forEach((scheme) => {

        handlers[scheme] = handler;
    });
};

const isSupported = function (protocol) {

    let scheme = protocol;
    if (scheme.slice(-1) === ':') {
        scheme = protocol.slice(0,-1);
    }

    return (scheme in handlers);
};

const PartialError = class extends Error {

    constructor(err, processed, expected) {

        super();

        if (err.stack) {
            Object.defineProperty(this, 'stack', {
                enumerable: false,
                configurable: false,
                get: function () {

                    return err.stack;
                }
            });
        }
        else {
            // eslint-disable-next-line no-caller
            Error.captureStackTrace(this, arguments.callee);
        }

        this.message = err.message || err.toString();
        this.processed = processed || -1;
        this.expected = expected;
    }
};

PartialError.prototype.name = 'Partial Error';

module.exports = exports = uristream;

exports.UriReader = UriReader;

exports.PartialError = PartialError;

exports.register = register;

exports.isSupported = isSupported;

require('./lib/file.js');
require('./lib/http.js');
require('./lib/data.js');
