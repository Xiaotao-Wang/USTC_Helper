// 组装可公开发布的干净包到 dist/：只含应用本体，不含个人课表数据与开发工具。
// 用法：node tools/publish.mjs
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  cpSync(join(root, f), join(dist, f));
}
cpSync(join(root, 'icons'), join(dist, 'icons'), { recursive: true });

console.log('dist/ 已生成（仅应用本体，无个人数据）。可整体上传到 GitHub Pages / Cloudflare Pages / Netlify。');