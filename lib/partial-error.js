'use strict';

exports.PartialError = class PartialError extends Error {

    constructor(err, processed, expected) {

        super();

        if (err.stack) {
            Object.defineProperty(this, 'stack', {
                enumerable: false,
                configurable: false,
                get: function () {

                    return err.stack;
                }
            });
        }
        else {
            // eslint-disable-next-line no-caller
            Error.captureStackTrace(this, arguments.callee);
        }

        this.message = err.message || err.toString();
        this.processed = processed || -1;
        this.expected = expected;
    }
};

exports.PartialError.prototype.name = 'Partial Error';
