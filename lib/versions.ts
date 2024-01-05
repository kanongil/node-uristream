import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);


const packageJsonFor = async (moduleName: string): Promise<any> => {

    try {
        const path = require.resolve(moduleName);
        const moduleIndex = path.lastIndexOf('/node_modules/');
        const moduleBase = pathToFileURL(moduleIndex !== -1 ? path.slice(0, moduleIndex + 14) : path);

        const contents = await readFile(new URL(`${moduleName}/package.json`, moduleBase), 'utf8');
        return JSON.parse(contents);
    }
    catch (err) {
        // ignore
        return undefined;
    }
};

const Pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const Got = await packageJsonFor('got') ?? { version: '<unknown>' };

export const name = Pkg.name as string;
export const module = Pkg.version as string;
export const got = Got.version as string;
