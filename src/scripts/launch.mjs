import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { launchAddress } from '../lib/local-address.mjs';

const { port, host, url, lan } = launchAddress();
const app = createApp({ dataFile: process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : undefined, demo: process.env.DEMO_MODE !== 'false' });
app.listen(port, host, () => {
  console.log(`\n校园岛已启动：${url}\n请保留这个窗口。关闭窗口或按 Ctrl+C 可以停止。\n`);
  if (lan) console.log(`手机访问：${url}\n手机与电脑需连接同一 Wi-Fi。若无法访问，可让电脑连接手机热点后重启此入口。\n此模式使用共享演示账号，请只用于可信网络中的演示。\n`);
  if (process.env.BROWSER === 'none') return;
  const commands = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(commands[0], commands[1], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => console.log('请在浏览器手动打开上面的地址。'));
  child.unref();
});
app.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。切换电脑和手机模式时，请先关闭原启动窗口，再重新启动。` : error.message);
  process.exitCode = 1;
});
