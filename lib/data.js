'use strict';

const Boom = require('@hapi/boom');
const DataUrl = require('dataurl');
//const debug = require('debug')('uristream:data');

const UriStream = require('../uristream');

const UriDataReader = class extends UriStream.UriReader {

    constructor(uri, options = {}) {

        super('data:', options);

        const parsed = DataUrl.parse(uri);

        if (!parsed || !parsed.data) {
            return this.destroy(Boom.badData());
        }

        const meta = { url: uri, mime: parsed.mimetype, size: parsed.data.length, modified: null };
        const limit = (this.end >= 0) ? this.end + 1 : meta.size;
        const bytes = limit - this.start;

        if (limit > meta.size || bytes < 0) {
            return this.destroy(Boom.rangeNotSatisfiable());
        }

        process.nextTick(() => {

            this.meta = meta;
            this.emit('meta', meta);

            if (!this.probe) {
                this.push(parsed.data.slice(this.start, this.end >= 0 ? this.end + 1 : undefined));
            }

            delete parsed.data;

            this.push(null);
            this.destroy();
        });
    }

    _read(n) {}
};

UriStream.register('data', UriDataReader);
