import type { UriReader } from './uri-reader';

const handlers = new Map<string, typeof UriReader>();


export const register = function (schemes: string | string[], handler: typeof UriReader): void {

    if (!Array.isArray(schemes)) {
        schemes = [schemes];
    }

    for (const scheme of schemes) {
        handlers.set(scheme, handler);
    }
};


export const lookup = function (scheme: string): typeof UriReader {

    const reader = handlers.get(scheme);
    if (!reader) {
        throw new Error('Failed to find reader');
    }

    return reader;
};


export const isSupported = function (protocol: string): boolean {

    let scheme = protocol;
    if (scheme.slice(-1) === ':') {
        scheme = protocol.slice(0, -1);
    }

    return handlers.has(scheme);
};
