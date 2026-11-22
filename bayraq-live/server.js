// L2M TikTok bridge: real LIVE gifts -> the flag game's standard L2M input.
// Run: node server.js <creator_username>  (public username, without @ is fine)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const here = fileURLToPath(new URL('.', import.meta.url));
const user = (process.argv[2] || process.env.TIKTOK_USER || '').replace(/^@/, '').trim();
const PORT = Number(process.env.PORT) || 3000;
if (!user) {
  console.error('İstifadə: node server.js <TikTok istifadəçi_adı>');
  process.exit(1);
}

const clients = new Set();
let status = { connected: false, user, note: 'TikTok LIVE bağlantısı hazırlanır…' };
const send = (event, data) => {
  const message = (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) response.write(message);
};
const setStatus = (connected, note) => {
  status = { connected, user, note };
  send('status', status);
  console.log(`[tiktok] ${note}`);
};

const INJECT = `<div id="ttb" style="position:fixed;left:16px;bottom:calc(12px + env(safe-area-inset-bottom,0px));padding:3px 12px;border-radius:99px;background:rgba(12,14,26,.78);color:#f6efe4;font:13px system-ui;border:1px solid rgba(255,255,255,.2)">TikTok LIVE: …</div>
<script>(()=>{const b=document.getElementById('ttb'),es=new EventSource('/events');
es.addEventListener('status',e=>{const s=JSON.parse(e.data);b.textContent='TikTok LIVE: '+(s.connected?'qoşuldu (@'+s.user+')':s.note)});
es.onmessage=e=>window.L2M_push(JSON.parse(e.data));es.onerror=()=>{b.textContent='TikTok LIVE: körpü ilə əlaqə yoxdur'}})();</script>`;

createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/' || req.url.startsWith('/?')) {
    const html = readFileSync(join(here, 'bayraq-oyunu.html'), 'utf8').replace('</body>', INJECT + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`Oyun: http://localhost:${PORT}`));

function onGift(event) {
  const giftId = event.giftId ?? event.gift?.id ?? event.extendedGiftInfo?.id;
  const giftName = event.gift?.name ?? event.extendedGiftInfo?.name ?? event.giftName ?? event.giftDetails?.giftName;
  const userName = event.user?.displayId ?? event.user?.uniqueId ?? event.uniqueId;
  const giftType = event.gift?.type ?? event.giftType ?? event.giftDetails?.giftType;
  const groupId = event.groupId == null ? undefined : String(event.groupId);
  const raw = {
    giftId: giftId == null ? undefined : String(giftId),
    giftName,
    user: userName,
    eventId: event.common?.msgIdStr ?? event.msgId?.toString?.(),
    groupId,
  };
  const count = Number(event.repeatCount ?? event.groupCount) || 1;
  if (giftType === 1) {
    raw.repeatCount = count;
    raw.repeatEnd = event.repeatEnd === true || event.repeatEnd === 1;
  } else {
    raw.repeat = count;
  }
  console.log(`[gift] #${raw.giftId ?? '?'} ${giftName ?? ''} x${count} from ${userName ?? '?'}`);
  send(null, raw);
}

let reconnectTimer;
let isConnecting = false;
let activeConnection;
function scheduleReconnect(delay = 5000) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}
async function connect() {
  if (isConnecting) return;
  isConnecting = true;
  const connection = new TikTokLiveConnection(user, {});
  activeConnection = connection;
  connection.on('gift', onGift);
  connection.on('error', error => {
    console.error('[tiktok] connection error:', error?.message || error);
  });
  connection.on('streamEnd', () => {
    if (activeConnection !== connection) return;
    setStatus(false, 'Yayım bitdi; LIVE açılanda yenidən qoşulmağa çalışıram.');
  });
  connection.on('disconnected', () => {
    if (activeConnection !== connection) return;
    setStatus(false, 'Bağlantı kəsildi; 5 saniyəyə yenidən qoşuluram.');
    scheduleReconnect();
  });
  try {
    const state = await connection.connect();
    if (activeConnection === connection) {
      setStatus(true, `Canlı yayıma qoşuldu${state?.roomId ? ` (room ${state.roomId})` : ''}`);
    }
  } catch (error) {
    if (activeConnection === connection) {
      setStatus(false, `Qoşulma alınmadı: ${error?.message || error}; yenidən yoxlayıram.`);
      scheduleReconnect(15000);
    }
  } finally {
    isConnecting = false;
  }
}
connect();

