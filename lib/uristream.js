'use strict';

const Url = require('url');

const Boom = require('@hapi/boom');

const { PartialError } = require('./partial-error');
const { register, lookup, isSupported } = require('./registry');
const { UriReader } = require('./uri-reader');


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

    const readerClass = lookup(scheme);
    return new readerClass(uri, options);
};


module.exports = exports = uristream;

exports.UriReader = UriReader;

exports.PartialError = PartialError;

exports.register = register;

exports.isSupported = isSupported;


require('./file.js');
require('./http.js');
require('./data.js');
