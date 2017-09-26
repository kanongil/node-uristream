'use strict';

const DataUrl = require('dataurl');
//const debug = require('debug')('uristream:data');

const UriStream = require('../uristream');

const UriDataReader = class extends UriStream.UriReader {

    constructor(uri, options) {

        super('data:', options);

        const parsed = DataUrl.parse(uri);
        const limit = (this.end >= 0) ? Math.min(parsed.data.length, this.end + 1) : parsed.data.length;
        const meta = { url:uri, mime:parsed.mimetype, size:limit - this.start, modified:null };
        process.nextTick(() => {

            this.meta = meta;
            this.emit('meta', this.meta);
        });

        if (!this.probe) {
            this.push(parsed.data.slice(this.start, this.end >= 0 ? this.end + 1 : undefined));
        }
        delete parsed.data;

        this.push(null);
    }

    _read(n) { }
};

UriStream.register('data', UriDataReader);
