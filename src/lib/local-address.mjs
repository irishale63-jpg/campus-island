import { networkInterfaces } from 'node:os';

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function launchAddress(env = process.env, interfaces = networkInterfaces()) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1—65535 的整数');
  if (env.LAN !== '1') return { port, host: '127.0.0.1', url: `http://127.0.0.1:${port}`, lan: false };
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !/loopback|virtual|vethernet|vmware|docker|wsl|tun|tap|clash|vpn|zerotier|tailscale/i.test(name))
    .flatMap(([name, entries]) => (entries || []).filter(n => n.family === 'IPv4' && !n.internal && isPrivateIPv4(n.address)).map(n => ({ name, address: n.address })))
    .sort((a, b) => Number(!/wi-fi|wlan|wireless|无线/i.test(a.name)) - Number(!/wi-fi|wlan|wireless|无线/i.test(b.name)));
  if (!candidates.length) throw new Error('没有找到可用的局域网地址。请将电脑连接 Wi-Fi 或手机热点后再启动。');
  const host = candidates[0].address;
  return { port, host, url: `http://${host}:${port}`, lan: true };
}
