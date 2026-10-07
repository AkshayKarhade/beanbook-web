import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const source = 'website/index.html';
const destination = 'dist/index.html';
const redirectsDestination = 'dist/_redirects';

await mkdir(dirname(destination), {
  recursive: true,
});

await copyFile(source, destination);

await writeFile(
  redirectsDestination,
  [
    '/beanbook/* /beanbook/index.html 200',
    '',
  ].join('\n'),
  'utf8'
);

console.log(
  'Public website and Netlify redirects copied to dist'
);
