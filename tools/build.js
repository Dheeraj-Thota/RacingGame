'use strict';
// Builds the standalone index.html from src/page.html, physics.js, track.json and src/client.js.
// The shipped page embeds the exact same physics and track the server uses for replay validation.
// Usage: node tools/build.js
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const notice = read('TRACK-LICENSE.txt').trim().replace(/\*\//g, '* /');
const parts = {
  '/*@@PHYSICS@@*/': `/* ${notice} */\n` + read('physics.js').trim(),
  '/*@@TRACK@@*/': 'const TRACK=' + JSON.stringify(JSON.parse(read('track.json'))) + ';',
  '/*@@CLIENT@@*/': read('src/client.js').trim()
};
let html = read('src/page.html');
for (const [marker, body] of Object.entries(parts)) {
  if (html.split(marker).length !== 2) throw Error('Marker missing or duplicated: ' + marker);
  html = html.replace(marker, () => body);
}
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KiB`);
