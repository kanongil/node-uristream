# Stream from URI-based resources

Supported protocols:

* `file:`
* `http:`
* `https:`
* `data:`

The `http(s)` handler transparently attempts to use gzip compression for the transport.

## Usage

    var uristream = require('uristream');

    uristream('http://google.com/').pipe(process.stdout);

## Methods

### uristream(uri, [options])

Returns a standard `Readable` stream based on the `uri`.

#### standard options

* `timeout` - Integer containing the number of milliseconds to wait for a stream to respond before aborting the stream.
* `probe` - Boolean that indicates that the stream should not return any data.
* `start` - Integer indicating the starting offset in bytes.

#### http options

The `http` and `https` protocol handlers will additionally accept these options:

* `headers` - Headers to add to the request.
* `agent` - Use supplied agent for the request.

#### Event: 'meta'

In addition to the standard `end`, `close`, and `error` events, a `meta` event is emitted once before any data is available.

* `meta` - Object containing standardized stream metadata:
  + `url` - String with resolved data url.
  + `mime` - String with mime type for the data.
  + `size` - Integer representing total data size in bytes. `-1` if unknown.
  + `modified` - Date last modified. `null` if unknown.

## Installation

    npm install uristream

## TODO

* More documentation
* Add tests
* Additional protocols (ftp?)

