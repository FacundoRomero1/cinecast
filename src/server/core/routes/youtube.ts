import { Router } from 'express';

export interface YouTubeTrackItem {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
}

interface YtTextRun {
  text?: string;
}

interface YtThumbnail {
  url?: string;
}

interface YtVideoRenderer {
  videoId?: string;
  title?: {
    runs?: YtTextRun[];
    simpleText?: string;
  };
  ownerText?: {
    runs?: YtTextRun[];
  };
  lengthText?: {
    simpleText?: string;
  };
  thumbnail?: {
    thumbnails?: YtThumbnail[];
  };
}

interface YtItemContent {
  videoRenderer?: YtVideoRenderer;
}

interface YtSectionContent {
  itemSectionRenderer?: {
    contents?: YtItemContent[];
  };
}

interface YtInitialData {
  contents?: {
    twoColumnSearchResultsRenderer?: {
      primaryContents?: {
        sectionListRenderer?: {
          contents?: YtSectionContent[];
        };
      };
    };
  };
}

export async function searchYouTubeTracks(query: string): Promise<YouTubeTrackItem[]> {
  if (!query || typeof query !== 'string') return [];
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const match =
      html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match || !match[1]) return [];
    const data = JSON.parse(match[1]) as YtInitialData;
    const items: YouTubeTrackItem[] = [];
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];
    for (const section of contents) {
      const itemSection = section?.itemSectionRenderer?.contents || [];
      for (const item of itemSection) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        const videoId = v.videoId;
        const title =
          v.title?.runs?.map((r) => r.text || '').join('') || v.title?.simpleText || '';
        const channel = v.ownerText?.runs?.map((r) => r.text || '').join('') || '';
        const duration = v.lengthText?.simpleText || '';
        const thumbnails = v.thumbnail?.thumbnails || [];
        const lastThumb = thumbnails[thumbnails.length - 1];
        const thumbnail =
          lastThumb && lastThumb.url
            ? lastThumb.url
            : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        items.push({ videoId, title, channel, duration, thumbnail });
        if (items.length >= 20) break;
      }
      if (items.length >= 20) break;
    }
    return items;
  } catch (err) {
    console.warn('[searchYouTubeTracks] Error:', err);
    return [];
  }
}

export function createYouTubeRouter(): Router {
  const router = Router();

  router.get('/media-search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    try {
      const results = await searchYouTubeTracks(q);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: String(err), results: [] });
    }
  });

  return router;
}

