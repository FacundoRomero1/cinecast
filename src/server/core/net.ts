import os from 'os';

export function isVirtualOrIgnored(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return /virtual|vmware|vbox|wsl|hyper-v|vethernet|tap|tun|tailscale|zerotier|loopback|docker|npcap|pseudo|teredo|radmin|hamachi|wireguard/i.test(lower);
}

export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  const validCandidates: { name: string; address: string }[] = [];

  for (const name of Object.keys(interfaces)) {
    if (isVirtualOrIgnored(name)) continue;
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const alias of ifaceList) {
      if (
        alias.family === 'IPv4' &&
        !alias.internal &&
        alias.address !== '127.0.0.1' &&
        !alias.address.startsWith('169.254.') &&
        !alias.address.startsWith('0.')
      ) {
        validCandidates.push({ name, address: alias.address });
      }
    }
  }

  // 1. Priorizar 192.168.x.x (WiFi / Ethernet residencial típico)
  const homeWifi = validCandidates.find((c) => c.address.startsWith('192.168.'));
  if (homeWifi) return homeWifi.address;

  // 2. Clase A 10.x.x.x
  const classA = validCandidates.find((c) => c.address.startsWith('10.'));
  if (classA) return classA.address;

  // 3. Clase B 172.16.x.x - 172.31.x.x
  const classB = validCandidates.find((c) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(c.address));
  if (classB) return classB.address;

  // 4. Cualquier otro candidato válido no virtual
  const firstCandidate = validCandidates[0];
  if (firstCandidate) return firstCandidate.address;

  // 5. Fallback si solo hubieran adaptadores virtuales
  const fallbackCandidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const alias of interfaces[name] || []) {
      if (
        alias.family === 'IPv4' &&
        !alias.internal &&
        alias.address !== '127.0.0.1' &&
        !alias.address.startsWith('169.254.')
      ) {
        fallbackCandidates.push(alias.address);
      }
    }
  }
  const fallbackHome = fallbackCandidates.find((ip) => ip.startsWith('192.168.'));
  if (fallbackHome) return fallbackHome;
  const firstFallback = fallbackCandidates[0];
  if (firstFallback) return firstFallback;

  return '';
}

