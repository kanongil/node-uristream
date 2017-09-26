'use strict';

const Util = require('util');
const Url = require('url');
const Readable = require('readable-stream').Readable;

const Boom = require('boom');


const UriReader = class extends Readable {

    constructor(uri, options) {

        options = options || {};

        super(options);

        this.url = Url.parse(uri);
        this.meta = null;

        // options
        this.timeout = options.timeout;
        this.probe = !!options.probe;
        this.start = ~~options.start;
        this.end = (parseInt(options.end, 10) == options.end) ? ~~options.end : undefined;
    }

    _read() { }

    abort(reason) {

        this.destroy(reason);
    }
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

const PartialError = function (err, processed, expected) {

    Error.call(this);

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
        Error.captureStackTrace(this, arguments.callee);
    }

    this.message = err.message || err.toString();
    this.processed = processed || -1;
    this.expected = expected;
};
Util.inherits(PartialError, Error);
PartialError.prototype.name = 'Partial Error';

module.exports = exports = uristream;

exports.UriReader = UriReader;
exports.PartialError = PartialError;
exports.register = register;
exports.isSupported = isSupported;

require('./lib/file.js');
require('./lib/http.js');
require('./lib/data.js');
