"use strict";

var util = require('util');

var dataurl = require('dataurl'),
    debug = require('debug')('uristream:data');

var uristream = require('../uristream');

function UriDataReader(uri, options) {
  var self = this;

  uristream.UriReader.call(this, 'data:', options);

  var parsed = dataurl.parse(uri);
  var meta = { url:uri, mime:parsed.mimetype, size:parsed.data.length, modified:null };
  process.nextTick(function() {
    self.meta = meta;
    self.emit('meta', self.meta);
  });

  if (!this.probe)
    this.push(parsed.data.slice(this.start));
  delete parsed.data;

  this.push(null);
}
util.inherits(UriDataReader, uristream.UriReader);

UriDataReader.prototype._read = function(n) {
};

uristream.register('data', UriDataReader);
