var util = require('util'),
    url = require('url'),
    Readable = require('readable-stream').Readable;

var Boom = require('boom');

if (!Readable)
  Readable = require('readable-stream');

module.exports = exports = uristream;

exports.UriReader = UriReader;
exports.PartialError = PartialError;
exports.register = register;
exports.isSupported = isSupported;

function UriReader(uri, options) {
  options = options || {};

  Readable.call(this, options);

  this.url = url.parse(uri);
  this.meta = null;

  // options
  this.timeout = options.timeout;
  this.probe = !!options.probe;
  this.start = ~~options.start;
  this.end = (parseInt(options.end, 10) == options.end) ? ~~options.end : undefined;

// TODO: allow piping directly to a http response, like in request
}
util.inherits(UriReader, Readable);

UriReader.prototype._read = function() {
};

UriReader.prototype.abort = function() {
//  this.destroy();
};

/*UriReader.prototype.destroy = function() {

};*/

var handlers = {};

function uristream(uri, options) {
  options = options || {};

  var protocol = url.parse(uri).protocol || '';
  if (!protocol)
    throw Boom.badRequest('Missing protocol in uri:', uri);

  if (!isSupported(protocol))
    throw Boom.badRequest('Unsupported protocol:', protocol);

  var scheme = protocol.slice(0,-1);
  if (options.whitelist && options.whitelist.indexOf(scheme) === -1)
    throw Boom.forbidden('Protocol not allowed:', protocol);

  if (options.blacklist && options.blacklist.indexOf(scheme) !== -1)
    throw Boom.forbidden('Protocol not allowed:', protocol);

  return new handlers[scheme](uri, options);
}

function register(schemes, handler) {
  if (!Array.isArray(schemes)) schemes = [schemes];

  schemes.forEach(function(scheme) {
    handlers[scheme] = handler;
  });
}

function isSupported(protocol) {
  var scheme = protocol;
  if (scheme.slice(-1) === ':')
    scheme = protocol.slice(0,-1);
  return (scheme in handlers);
}

function PartialError(err, processed, expected) {
  Error.call(this);

  if (err.stack) {
    Object.defineProperty(this, 'stack', {
      enumerable: false,
      configurable: false,
      get: function() { return err.stack; }
    });
  }
  else Error.captureStackTrace(this, arguments.callee);

  this.message = err.message || err.toString();
  this.processed = processed || -1;
  this.expected = expected;
}
util.inherits(PartialError, Error);
PartialError.prototype.name = 'Partial Error';

var file_proto = require('./lib/file.js'),
    http_proto = require('./lib/http.js'),
    data_proto = require('./lib/data.js');
