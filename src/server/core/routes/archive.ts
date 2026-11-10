import { Router } from 'express';

interface ArchiveDoc {
  identifier?: string;
  title?: string;
  description?: string;
  year?: string | number;
  downloads?: number;
}

interface ArchiveSearchResponse {
  response?: {
    docs?: ArchiveDoc[];
  };
}

interface ArchiveFileEntry {
  name?: string;
}

interface ArchiveMetadataResponse {
  files?: ArchiveFileEntry[];
}

export function createArchiveRouter(): Router {
  const router = Router();

  // ARCHIVE.ORG CORS PROXY & MP4 STREAM RESOLVER
  router.get('/archive/search', async (req, res) => {
    try {
      const rawQ = typeof req.query.q === 'string' ? req.query.q : 'classic';
      const rawRows = typeof req.query.rows === 'string' ? req.query.rows : '12';
      const query = (rawQ || 'classic').trim();
      const rows = Math.min(24, parseInt(rawRows, 10) || 12);
      const searchQ = `(${query}) AND mediatype:(movies) AND collection:(feature_films OR moviesandfilms)`;
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
        searchQ
      )}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&page=1&output=json`;

      const response = await fetch(url);
      if (!response.ok) {
        res.json({ docs: [] });
        return;
      }
      const data = (await response.json()) as ArchiveSearchResponse;
      const docs = data?.response?.docs || [];
      res.json({ docs });
    } catch (err) {
      console.error('Archive.org search proxy error:', err);
      res.json({ docs: [] });
    }
  });

  router.get('/archive/resolve/:identifier', async (req, res) => {
    const { identifier } = req.params;
    try {
      const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
      if (!metaRes.ok) {
        res.json({
          streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
        });
        return;
      }
      const meta = (await metaRes.json()) as ArchiveMetadataResponse;
      const files: ArchiveFileEntry[] = Array.isArray(meta?.files) ? meta.files : [];
      const mp4File =
        files.find(
          (f) => typeof f.name === 'string' && f.name.endsWith('.mp4') && !f.name.includes('_ia')
        ) || files.find((f) => typeof f.name === 'string' && f.name.endsWith('.mp4'));

      if (mp4File && mp4File.name) {
        res.json({
          streamUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(mp4File.name)}`,
        });
        return;
      }
      res.json({
        streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
      });
    } catch (_) {
      res.json({
        streamUrl: `https://archive.org/download/${identifier}/${identifier}_512kb.mp4`,
      });
    }
  });

  return router;
}
