# Stream from URI-based resources

Supported protocols:

* `file:`
* `http:`
* `https:`
* `data:`

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

## Installation

    npm install uristream

## TODO

* More documentation
* Add tests
* Additional protocols (ftp?)

