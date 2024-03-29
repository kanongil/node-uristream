# Stream from URI-based resources

Supported protocols:

* `file:`
* `http:`
* `https:`
* `data:`

The `http(s)` handler transparently attempts to use gzip compression for the transport.

## Usage

    import uristream from 'uristream';

    uristream('http://google.com/').pipe(process.stdout);

## Methods

### uristream(uri, [options])

Returns a standard `Readable` stream based on the `uri`.

#### standard options

* `highWaterMark` - `ReadableStream` property that sets size of internal data buffer.
* `timeout` - Integer containing the number of milliseconds to wait for a stream to respond before aborting the stream.
* `probe` - Boolean that indicates that the stream should not return any data.
* `start` - Integer indicating the starting offset in bytes.
* `end` - Integer indicating the end offset in bytes.

#### http options

The `http` and `https` protocol handlers will additionally accept these options:

* `headers` - Headers to add to the request.
* `agent` - Use supplied agent for the request.
* `retries` - Retry request on temporary errors, default `1`.
* `enableUnixSockets` - Set to handle [unix socket urls](https://github.com/sindresorhus/got/blob/v14.0.0/documentation/2-options.md#enableunixsockets).

#### Event: 'meta'

A special `meta` event is emitted once, before any data is delivered.

* `meta` - Object containing standardized stream metadata:
  + `url` - String with resolved data url.
  + `mime` - String with mime type for the data.
  + `size` - Integer representing total data size in bytes. `-1` if unknown.
  + `modified` - Date last modified. `null` if unknown.
  + `etag` - String entity tag. `undefined` if unknown.

#### Event: 'fetched'

The `fetched` event can be used to be notified when the remote fetch has finished.
This can happen before `end` or `error` is emitted, if the stream is consumed slowly and it has an internal buffer.

Note that attaching a listerner for this, will also defer a remote fetch error `error` emit until the internal buffer
has emptied, instead of immediately triggering.

* `err` - Fetch failure `Error`, or `undefined` if successful:

## Installation

    npm install uristream

## TODO

* More documentation
* Add tests
* Additional protocols (ftp?)

# License

(BSD 2-Clause License)

Copyright (c) 2013-2024, Gil Pedersen &lt;gpdev@gpost.dk&gt;
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
