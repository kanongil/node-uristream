"use strict";

// RFC 1738 file: URI support

var util = require('util'),
    mime = require('mime-types'),
    fs = require('fs');

var oncemore = require('oncemore'),
    debug = require('debug')('uristream:file');

var uristream = require('../uristream');

module.exports = exports = UriFileReader;

var PREFIX = 'file://';

function noop() {};

function pump(src, dst, done) {
  src.on('data', function(chunk) {
    if (!dst.push(chunk))
      src.pause();
  });
  oncemore(src).once('end', 'error', function(err) {
    // TODO: flush source buffer on error?
    dst._read = noop;
    done(err);
  });
  dst._read = function(n) {
    src.resume();
  };
}

function UriFileReader(uri, options) {
  var self = this;

  uristream.UriReader.call(this, uri, options);

  if (uri.slice(0,PREFIX.length) !== PREFIX)
    throw new Error('invalid uri prefix: ' + uri);

  if (!(this.url.host === '' || this.url.host === 'localhost'))
    throw new Error('only local file uri\' are supported: ' + uri);

  this.path = this.url.path;

  fs.stat(this.path, function(err, stats) {
    if (err) return self.emit('error', err);

    var meta = { url:uri, mime:mime.lookup(self.path) || 'application/octet-stream', size:stats.size, modified:stats.mtime };
    self.meta = meta;
    self.emit('meta', self.meta);

    if (self.probe)
      return self.push(null);

    var size = meta.size - self.start;
    var src = oncemore(fs.createReadStream(self.path, {
      start: self.start
    }));

    src.on('close', function() {
      self.closed = true;
      self.emit('close');
    });

    self.abort = function(reason) {
      if (!self.closed)
        src.destroy();
    }

    pump(src, self, function(err) {
      if (!err && accum !== size) err = new Error('Stream length did not match stats');
      if (err) return self.emit('error', err);

      debug('done fetching uri', uri);
      self.push(null);
    });

    var accum = 0;
    src.on('data', function(chunk) {
      accum += chunk.length;
      if (accum > size)
        src.destroy();
    });
  });
}
util.inherits(UriFileReader, uristream.UriReader);

UriFileReader.prototype._read = function() {};

uristream.register('file', UriFileReader);
