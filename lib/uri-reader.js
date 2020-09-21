'use strict';

const Url = require('url');

const { Readable } = require('readable-stream');


exports.UriReader = class UriReader extends Readable {

    constructor(uri, { highWaterMark, autoDestroy = true, emitClose = true, ...options }) {

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

    _read() { }
};

