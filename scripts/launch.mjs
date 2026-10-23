import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1—65535 的整数');
const url = `http://127.0.0.1:${port}`;
const app = createApp({ dataFile: process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : undefined, demo: process.env.DEMO_MODE !== 'false' });
app.listen(port, '127.0.0.1', () => {
  console.log(`\n善意同行已启动：${url}\n请保留这个窗口。关闭窗口或按 Ctrl+C 可以停止。\n`);
  if (process.env.BROWSER === 'none') return;
  const commands = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(commands[0], commands[1], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => console.log('请在浏览器手动打开上面的地址。'));
  child.unref();
});
app.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。若项目已经启动，请直接打开 ${url}；否则关闭占用端口的程序后再试。` : error.message);
  process.exitCode = 1;
});
