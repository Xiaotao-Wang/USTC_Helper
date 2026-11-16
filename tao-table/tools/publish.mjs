// 组装可公开发布的干净包到 dist/：只含应用本体，不含个人课表数据与开发工具。
// dist/ 可同时作为发布用 git 仓库；本脚本只覆盖应用文件，保留 .git 以便持续推送。
// 用法：node tools/publish.mjs
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const APP_FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'icons'];

mkdirSync(dist, { recursive: true });
for (const f of APP_FILES) rmSync(join(dist, f), { recursive: true, force: true });

for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  cpSync(join(root, f), join(dist, f));
}
cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true });

console.log('dist/ 已生成（仅应用本体，无个人数据，保留 .git）。可整体上传或 git push 到 GitHub Pages / Cloudflare Pages / Netlify。');