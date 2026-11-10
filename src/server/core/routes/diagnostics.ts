import { Router } from 'express';

export interface DiagnosticsOptions {
  getMode: () => boolean;
  setMode: (val: boolean) => void;
  getNoCorsFix: () => boolean;
  setNoCorsFix: (val: boolean) => void;
  onChange: () => void;
}

export function createDiagnosticsRouter(options: DiagnosticsOptions): Router {
  if (
    !options ||
    typeof options.getMode !== 'function' ||
    typeof options.setMode !== 'function' ||
    typeof options.getNoCorsFix !== 'function' ||
    typeof options.setNoCorsFix !== 'function' ||
    typeof options.onChange !== 'function'
  ) {
    throw new Error(
      'createDiagnosticsRouter requiere inyección obligatoria: { getMode, setMode, getNoCorsFix, setNoCorsFix, onChange }'
    );
  }

  const router = Router();

  router.get('/diagnostic-mode', (req, res) => {
    let changed = false;
    if (req.query.enabled !== undefined) {
      options.setMode(req.query.enabled === 'true');
      changed = true;
    }
    if (req.query.noCorsFix !== undefined) {
      options.setNoCorsFix(req.query.noCorsFix === 'true');
      changed = true;
    }
    if (changed) options.onChange();
    res.json({ diagnosticMode: options.getMode(), noCorsFix: options.getNoCorsFix() });
  });

  router.post('/diagnostic-mode', (req, res) => {
    let changed = false;
    const body = req.body as { enabled?: unknown; noCorsFix?: unknown } | undefined;
    if (body?.enabled !== undefined) {
      options.setMode(Boolean(body.enabled));
      changed = true;
    }
    if (body?.noCorsFix !== undefined) {
      options.setNoCorsFix(Boolean(body.noCorsFix));
      changed = true;
    }
    if (changed) options.onChange();
    res.json({ diagnosticMode: options.getMode(), noCorsFix: options.getNoCorsFix() });
  });

  return router;
}
