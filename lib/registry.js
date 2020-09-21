'use strict';

const handlers = new Map();


exports.register = function (schemes, handler) {

    if (!Array.isArray(schemes)) {
        schemes = [schemes];
    }

    for (const scheme of schemes) {
        handlers.set(scheme, handler);
    }
};


exports.lookup = function (scheme) {

    return handlers.get(scheme);
};


exports.isSupported = function (protocol) {

    let scheme = protocol;
    if (scheme.slice(-1) === ':') {
        scheme = protocol.slice(0, -1);
    }

    return handlers.has(scheme);
};
