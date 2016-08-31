"use strict";

const util = require('util');

const dataurl = require('dataurl');
const debug = require('debug')('uristream:data');

const uristream = require('../uristream');

function UriDataReader(uri, options) {
  uristream.UriReader.call(this, 'data:', options);

  let parsed = dataurl.parse(uri);
  let limit = (this.end >= 0) ? Math.min(parsed.data.length, this.end + 1) : parsed.data.length;
  let meta = { url:uri, mime:parsed.mimetype, size:limit - this.start, modified:null };
  process.nextTick(() => {
    this.meta = meta;
    this.emit('meta', this.meta);
  });

  if (!this.probe)
    this.push(parsed.data.slice(this.start, this.end >= 0 ? this.end + 1 : undefined));
  delete parsed.data;

  this.push(null);
}
util.inherits(UriDataReader, uristream.UriReader);

UriDataReader.prototype._read = function(n) {
};

uristream.register('data', UriDataReader);
