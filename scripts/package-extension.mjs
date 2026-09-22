/**
 * Packs the built extension into a zip someone can install without a
 * toolchain (BC-064): unzip it, then Load unpacked in the browser.
 *
 * Writes the archive with Node's zlib rather than a zip library, so the
 * repository keeps its habit of no build dependencies. Run after a build:
 *
 *   pnpm build && node scripts/package-extension.mjs
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'packages', 'extension', 'dist');
const outDir = resolve(root, 'release');
const version = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8')).version;
const outFile = resolve(outDir, `breadcrumb-extension-${version}.zip`);

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Everything under dist, sorted, so the same input gives the same archive. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

/** Source maps are for developers and would double the download. */
const files = walk(dist).filter((file) => !file.endsWith('.map'));
if (files.length === 0) {
  console.error(`Nothing to package in ${dist}. Run "pnpm build" first.`);
  process.exit(1);
}

// One fixed timestamp, so rebuilding the same commit gives the same bytes.
const dosTime = 0;
const dosDate = (2026 - 1980) << 9;

const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  const name = relative(dist, file).split(sep).join('/');
  const contents = readFileSync(file);
  const deflated = deflateRawSync(contents, { level: 9 });
  // Storing beats deflating when deflating made it bigger, which happens with tiny files.
  const stored = deflated.length >= contents.length;
  const body = stored ? contents : deflated;
  const method = stored ? 0 : 8;
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(contents);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBytes, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0, 8);
  entry.writeUInt16LE(method, 10);
  entry.writeUInt16LE(dosTime, 12);
  entry.writeUInt16LE(dosDate, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(contents.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt16LE(0, 30);
  entry.writeUInt16LE(0, 32);
  entry.writeUInt16LE(0, 34);
  entry.writeUInt16LE(0, 36);
  entry.writeUInt32LE(0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);

  offset += local.length + nameBytes.length + body.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, Buffer.concat([...locals, directory, end]));

const size = statSync(outFile).size;
console.log(`${outFile}`);
console.log(`${files.length} files, ${(size / 1024).toFixed(0)} KB, version ${version}`);
