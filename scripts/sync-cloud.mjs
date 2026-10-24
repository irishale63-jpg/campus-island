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
    body = body.replace('示例数据 · 可操作演示', '公开演示 · 请勿填写个人信息')
      .replace('这些是演示身份。你可以切换身份，体验同一次互助的两端。未接入学校身份认证。', '演示身份由所有访客共用，协作内容也可能被其他体验者看到。请勿填写真实个人信息。')
      .replace('适合发布日常、无偿的小需求。请使用校园公共地点，不要填写私人住址或公开联系方式。', '这是公开演示，身份由所有访客共用。请只填写模拟内容，不要填写姓名、电话或私人地址。')
      .replace('当前为本地演示版，全部初始需求为示例。', '当前为公开演示版，全部初始需求为示例；访客共用演示身份。');
  }
  assets[route] = { body, type: type + '; charset=utf-8' };
}
writeFileSync(resolve(cloud, 'lib/site-assets.mjs'), 'export const assets = ' + JSON.stringify(assets) + ';\n');
console.log('Synced public interface and shared business rules; local user data excluded.');
