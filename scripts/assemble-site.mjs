import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const source = 'website/index.html';
const destination = 'dist/index.html';

await mkdir(dirname(destination), {
  recursive: true,
});

await copyFile(source, destination);

console.log(
  'Public website copied to dist/index.html'
);
