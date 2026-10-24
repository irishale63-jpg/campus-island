import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cloud = resolve(root, 'sites/campus-kindness');
mkdirSync(resolve(cloud, 'lib'), { recursive: true });
mkdirSync(resolve(cloud, 'public'), { recursive: true });
copyFileSync(resolve(root, 'public/favicon.svg'), resolve(cloud, 'public/favicon.svg'));
for (const file of ['domain.mjs', 'seed.mjs', 'cloud-api.mjs']) copyFileSync(resolve(root, 'lib', file), resolve(cloud, 'lib', file));
const assets = {};
for (const [route, file, type] of [['/','index.html','text/html'],['/styles.css','styles.css','text/css'],['/app.js','app.js','text/javascript'],['/favicon.svg','favicon.svg','image/svg+xml']]) {
  let body = readFileSync(resolve(root, 'public', file), 'utf8');
  if (file === 'index.html') {
    body = body.replace('演示体验 · 来试一试', '演示体验 · 用小事试一试')
      .replace('挑一个身份，体验同一次互助的两端。这里是模拟校园，暂未接入学校认证。', '欢迎来试一试。三个演示身份由访客共用，建议用模拟内容体验，把真实个人信息留在自己手里。')
      .replace('当前为本地演示版，全部初始需求为示例。', '当前为公开演示版，全部初始需求为示例。');
  }
  assets[route] = { body, type: type + '; charset=utf-8' };
}
writeFileSync(resolve(cloud, 'lib/site-assets.mjs'), 'export const assets = ' + JSON.stringify(assets) + ';\n');
console.log('Synced public interface and shared business rules; local user data excluded.');
