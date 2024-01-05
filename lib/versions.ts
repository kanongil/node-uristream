import { readFile } from 'node:fs/promises';

const Pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const Got = JSON.parse(await readFile(new URL('../node_modules/got/package.json', import.meta.url), 'utf8'));

export const name = Pkg.name as string;
export const module = Pkg.version as string;
export const got = Got.version as string;
