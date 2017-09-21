'use strict';

const Util = require('util');

const DataUrl = require('dataurl');
//const debug = require('debug')('uristream:data');

const UriStream = require('../uristream');

const UriDataReader = function (uri, options) {

    UriStream.UriReader.call(this, 'data:', options);

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
};
Util.inherits(UriDataReader, UriStream.UriReader);

UriDataReader.prototype._read = function (n) {
};

UriStream.register('data', UriDataReader);
