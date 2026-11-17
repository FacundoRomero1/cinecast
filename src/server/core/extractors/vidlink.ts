import {
  randomBytes,
  createDecipheriv,
  createCipheriv,
} from 'node:crypto';

export interface VidLinkStream {
  id: string;
  type: string;
  playlist: string;
  flags?: string[];
  captions?: Array<{
    id: string;
    url: string;
    language: string;
    type: string;
    hasCorsRestrictions: boolean;
  }>;
}

export interface VidLinkVideo {
  sourceID: string;
  stream: VidLinkStream;
}

const API_URL = 'https://vidlink.pro/api/b';
const keyHex = '2de6e6ea13a9df9503b11a6117fd7e51941e04a0c223dfeacfe8a1dbb6c52783';
const algo = 'aes-256-cbc';

function encrypt(data: string): string {
  const iv = randomBytes(16);
  const key = Buffer.from(keyHex, 'hex').subarray(0, 32);
  const cipher = createCipheriv(algo, key, iv);
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptClearKey(data: string): string {
  const [ivHex, encryptedHex] = data.split(':');
  if (!ivHex || !encryptedHex) return '';
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const key = Buffer.from(keyHex, 'hex').subarray(0, 32);
  const decipher = createDecipheriv(algo, key, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

export type VidLinkParams = {
  id: string;
  type: 'movie' | 'tv' | 'anime';
  season?: number;
  episode?: number;
  dub?: boolean;
};

/**
 * Extrae directamente los streams de video HLS (.m3u8) desde la API de VidLink Pro
 * basándose en la librería vidsrc-bypass / vidsrc-utils.
 */
export async function getVidLinkProVideo(params: VidLinkParams): Promise<VidLinkVideo | undefined> {
  const encodedId = Buffer.from(encrypt(params.id)).toString('base64');
  let url: string;

  switch (params.type) {
    case 'tv':
      url = `${API_URL}/tv/${encodedId}/${params.season || 1}/${params.episode || 1}`;
      break;
    case 'anime':
      url = `${API_URL}/anime/${encodedId}/${params.episode || 1}/${params.dub ? 'dub' : 'sub'}`;
      break;
    case 'movie':
    default:
      url = `${API_URL}/movie/${encodedId}`;
      break;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': 'https://vidlink.pro/',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[getVidLinkProVideo] HTTP ${res.status} al consultar ${url}`);
      return undefined;
    }

    const text = await res.text();
    if (!text || text === 'null' || !text.includes(':')) {
      return undefined;
    }

    const decrypted = decryptClearKey(text);
    if (!decrypted) return undefined;
    return JSON.parse(decrypted);
  } catch (err: any) {
    console.warn('[getVidLinkProVideo] Error:', err?.message || err);
    return undefined;
  }
}
