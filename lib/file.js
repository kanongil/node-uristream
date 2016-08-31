'use strict';

// RFC 1738 file: URI support

const util = require('util');
const mime = require('mime-types');
const fs = require('fs');

const Boom = require('boom');
const oncemore = require('oncemore');
const debug = require('debug')('uristream:file');

const uristream = require('../uristream');

module.exports = exports = UriFileReader;

const PREFIX = 'file://';

function noop() {};

function pump(src, dst, done) {
  src.on('data', (chunk) => {
    if (!dst.push(chunk))
      src.pause();
  });
  oncemore(src).once('end', 'error', (err) => {
    // TODO: flush source buffer on error?
    dst._read = noop;
    done(err);
  });
  dst._read = (n) => {
    src.resume();
  };
}

function UriFileReader(uri, options) {
  uristream.UriReader.call(this, uri, options);

  if (uri.slice(0,PREFIX.length) !== PREFIX)
    throw Boom.badRequest('invalid uri prefix: ' + uri);

  if (!(this.url.host === '' || this.url.host === 'localhost'))
    throw Boom.badRequest('only local file uri\' are supported: ' + uri);

  this.path = this.url.path;

  fs.stat(this.path, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') err = Boom.notFound('no such file');
      else if (err.code === 'EACCES') err = Boom.forbidden('permission error');
      else err = Boom.badImplementation('unknown access error: ' + err.code, err);
      return this.emit('error', err);
    }
    if (stats.isDirectory())
      return this.emit('error', Boom.forbidden('directory listing is not allowed'));

    let limit = (this.end >= 0) ? Math.min(stats.size, this.end + 1) : stats.size;
    let bytes = limit - this.start;

    let meta = { url:uri, mime:mime.lookup(this.path) || 'application/octet-stream', size:bytes, modified:stats.mtime };
    this.meta = meta;
    this.emit('meta', this.meta);

    if (this.probe)
      return this.push(null);

    let src = oncemore(fs.createReadStream(this.path, {
      start: this.start,
      end: this.end
    }));

    src.on('close', () => {
      this.closed = true;
      this.emit('close');
    });

    this.abort = (reason) => {
      if (!this.closed)
        src.destroy();
    };

    pump(src, this, (err) => {
      if (!err && accum !== bytes) err = new Error('stream length did not match stats');
      if (err) return this.emit('error', Boom.badImplementation('transmission error', err));

      debug('done fetching uri', uri);
      this.push(null);
    });

    let accum = 0;
    src.on('data', (chunk) => {
      accum += chunk.length;
      if (accum > bytes)
        src.destroy();
    });
  });
}
util.inherits(UriFileReader, uristream.UriReader);

UriFileReader.prototype._read = function() {};

uristream.register('file', UriFileReader);
