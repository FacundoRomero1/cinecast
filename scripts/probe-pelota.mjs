async function inspectChannels() {
  const ids = ['a004','a005','a010','a011','a012','a013','a015','a018','a020','a021','a022','a023','a024','a025','a026','a027','a028','a029','a030','a031','a033','a034','a035','a036'];
  for (const id of ids) {
    try {
      const u = 'http://190.61.47.54:8000/play/' + id + '/index.m3u8';
      const res = await fetch(u, { signal: AbortSignal.timeout(2000) });
      const t = await res.text();
      // Look for comments or variant playlist names
      const subLine = t.split('\n').find(l => l.includes('.m3u8')) || '';
      console.log(id, '->', subLine.trim());
    } catch (_) {}
  }
}
inspectChannels();
