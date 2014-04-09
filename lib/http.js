"use strict";

var util = require('util'),
    url = require('url'),
    zlib = require('zlib');

var request = require('request'),
    extend = require('xtend'),
    oncemore = require('oncemore'),
    debug = require('debug')('uristream:http');

var uristream = require('../uristream');

var pkg = require('../package');
var DEFAULT_AGENT = util.format('%s/v%s request/v%s node.js/%s', pkg.name, pkg.version, require('request/package').version, process.version);

module.exports = exports = UriHttpReader;

function noop() {};

// forward errors emitted upstream
function inheritErrors(stream) {
  stream.on('pipe', function(source) {
    source.on('error', stream.emit.bind(stream, 'error'));
  });
  stream.on('unpipe', function(source) {
    source.removeListener('error', stream.emit.bind(stream, 'error'));
  });
  return stream;
}

// 'pipe' any stream to a Readable
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

function UriHttpReader(uri, options) {
  var self = this;

  options = options || {};

  uristream.UriReader.call(this, uri, options);

  var defaults = {
    'user-agent': DEFAULT_AGENT
  };

  var offset = this.start;
  var agent = options.agent || null;

  var tries = 10;
  if (!this.probe) defaults['accept-encoding'] = ['gzip','deflate'];

  var fetch = this.probe ? request.head : request.get;

  // TODO: handle case in header names
  var headers = extend(defaults, options.headers);
  if ('range' in headers)
    throw new Error('Range header is not allowed - use start an end options');

  // attach empty 'error' listener to keep from ever throwing
  this.on('error', noop);

  function fetchHttp(start) {
    if (start > 0)
      headers['range'] = 'bytes=' + start + '-';

    var accum = 0, size = -1;
    var req = fetch({uri:uri, headers:headers, agent:agent, timeout:self.timeout});
    req.on('error', onreqerror);
    req.on('response', onresponse);

    var failed = false;
    function failOrRetry(err, permanent) {
      if (failed) return;
      failed = true;

      req.abort();
      if (--tries <= 0 || permanent) {
        // remap error to partial error if we have received any data
        if (start - offset + accum !== 0)
          err = new uristream.PartialError(err, start - offset + accum, (size !== -1) ? start - offset + size : size);
        return self.emit('error', err);
      }
      debug('retrying at ' + (start + accum));

      // TODO: delay retry?
      fetchHttp(start + accum);
    }

    function reqcleanup() {
      req.removeListener('error', onreqerror);
      req.removeListener('response', onresponse);
      req.on('error', noop);
    }

    function onreqerror(err) {
      reqcleanup();
      failOrRetry(err);
    }

    function onresponse(res) {
      reqcleanup();

      function isPermanent(code) {
        // very conservative list of permanent response codes
        return code === 301 || code === 400 || code === 401 || code === 410 || code === 501;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206)
        return failOrRetry(new Error('Bad server response code: '+res.statusCode), isPermanent(res.statusCode));

      if (res.headers['content-length']) size = parseInt(res.headers['content-length'], 10);
      var filesize = (size >= 0) ? start + size : -1;

      // transparently handle gzip responses
      var stream = res;
      if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'deflate') {
        var unzip = zlib.createUnzip();
        stream = stream.pipe(inheritErrors(unzip));
        filesize = -1;
      }

      // pipe it to self
      pump(stream, self, function(err) {
        if (err || failed) return failOrRetry(err);
        debug('done fetching uri', uri);
        self.push(null);

        self.closed = true;
        self.emit('close');
      });

      // allow aborting the request
      self.abort = function(reason) {
        if (!self.closed) {
          tries = 0;
          req.abort();
        }
      }

      // forward all future errors to response stream
      req.on('error', function(err) {
        self.emit('error', err);
      });

      // turn bad content-length into actual errors
      if (size >= 0 && !self.probe) {
        res.on('data', function(chunk) {
          accum += chunk.length;
          if (accum > size)
            req.abort();
        });

        oncemore(res).once('end', 'error', function(err) {
          if (!err && accum !== size)
            failOrRetry(new Error('Stream length did not match header'));
        });
      }

      // extract meta information from header
      var typeparts = /^(.+?\/.+?)(?:;\w*.*)?$/.exec(res.headers['content-type']) || [null, 'application/octet-stream'],
          mimetype = typeparts[1].toLowerCase(),
          modified = res.headers['last-modified'] ? new Date(res.headers['last-modified']) : null;

      var meta = { url:url.format(req.uri), mime:mimetype, size:filesize, modified:modified };
      if (self.meta) {
        if (!equal(self.meta, meta)) {
          tries = 0;
          failOrRetry(new Error('File has changed'));
        }
      } else  {
        self.meta = meta;
        self.emit('meta', self.meta);
      }
    }
  }

  fetchHttp(offset);
}
util.inherits(UriHttpReader, uristream.UriReader);

uristream.register(['http', 'https'], UriHttpReader);
