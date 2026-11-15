/**
 * src/app/syncAuditor.ts
 * Auditor de sincronía para CineCast TV.
 * Muestrea cada 500 ms en PC y celular:
 * { hora, playing, tiempo, duracion, capitulo(T,E), titulo, servidor, vol, mute, subs, marathon, stateSeq, age }
 * Al terminar calcula divergencias:
 * - Diferencia de tiempo (media, máxima)
 * - Diferencia de campos + duración en ms de cada divergencia
 * - Top 10 peores momentos con causa probable
 * - Exportable a JSON
 */

export interface SyncSample {
  hora: string;
  timestamp: number;
  role: 'screen' | 'remote';
  playing: boolean;
  tiempo: number;
  duracion: number;
  capitulo: { season?: number; episode?: number };
  titulo: string;
  servidor: string;
  vol: number;
  mute: boolean;
  subs: boolean;
  marathon: boolean;
  stateSeq: number;
  age: number;
}

export interface FieldDivergenceStat {
  field: string;
  divergenceCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export interface WorstMoment {
  hora: string;
  timestamp: number;
  timeDiffSec: number;
  divergentFields: string[];
  probableCause: string;
  pcSample: Partial<SyncSample>;
  phoneSample: Partial<SyncSample>;
}

export interface SyncAuditReport {
  timestamp: string;
  durationSec: number;
  totalSamples: number;
  meanTimeDiffSec: number;
  maxTimeDiffSec: number;
  divergencesOver2sCount: number;
  fieldDivergences: FieldDivergenceStat[];
  top10WorstMoments: WorstMoment[];
  summaryStatus: 'PASA' | 'FALLA';
}

export function computeSyncAuditReport(
  pcSamples: SyncSample[],
  phoneSamples: SyncSample[]
): SyncAuditReport {
  const paired: { pc: SyncSample; phone: SyncSample }[] = [];

  // Emparejar muestras por proximidad temporal (< 400 ms)
  for (const pc of pcSamples) {
    let closest: SyncSample | null = null;
    let minDiff = Infinity;
    for (const ph of phoneSamples) {
      const diff = Math.abs(pc.timestamp - ph.timestamp);
      if (diff < minDiff && diff < 450) {
        minDiff = diff;
        closest = ph;
      }
    }
    if (closest) {
      paired.push({ pc, phone: closest });
    }
  }

  if (paired.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      durationSec: 0,
      totalSamples: 0,
      meanTimeDiffSec: 0,
      maxTimeDiffSec: 0,
      divergencesOver2sCount: 0,
      fieldDivergences: [],
      top10WorstMoments: [],
      summaryStatus: 'FALLA',
    };
  }

  let totalTimeDiff = 0;
  let maxTimeDiff = 0;
  let divergencesOver2s = 0;

  const fieldKeys = [
    'playing',
    'capitulo',
    'titulo',
    'servidor',
    'vol',
    'mute',
    'subs',
    'marathon',
  ] as const;

  const fieldStreaks: Record<string, { inStreak: boolean; startTs: number; durations: number[] }> = {};
  for (const f of fieldKeys) {
    fieldStreaks[f] = { inStreak: false, startTs: 0, durations: [] };
  }

  const moments: {
    hora: string;
    timestamp: number;
    timeDiffSec: number;
    divergentFields: string[];
    probableCause: string;
    pcSample: Partial<SyncSample>;
    phoneSample: Partial<SyncSample>;
    severityScore: number;
  }[] = [];

  for (let i = 0; i < paired.length; i++) {
    const { pc, phone } = paired[i];
    const ts = pc.timestamp;

    // Diferencia de tiempo: solo si ambos están en el mismo título
    const sameMedia = pc.titulo && phone.titulo && pc.titulo === phone.titulo;
    const timeDiff = sameMedia ? Math.abs(pc.tiempo - phone.tiempo) : 0;
    totalTimeDiff += timeDiff;
    if (timeDiff > maxTimeDiff) {
      maxTimeDiff = timeDiff;
    }

    const divergentFieldsNow: string[] = [];

    // Comprobar divergencias de campos
    if (pc.playing !== phone.playing) divergentFieldsNow.push('playing');
    if (
      (pc.capitulo.season ?? 1) !== (phone.capitulo.season ?? 1) ||
      (pc.capitulo.episode ?? 1) !== (phone.capitulo.episode ?? 1)
    ) {
      divergentFieldsNow.push('capitulo');
    }
    if (pc.titulo !== phone.titulo) divergentFieldsNow.push('titulo');
    if (pc.servidor !== phone.servidor) divergentFieldsNow.push('servidor');
    if (Math.abs(pc.vol - phone.vol) > 5) divergentFieldsNow.push('vol');
    if (pc.mute !== phone.mute) divergentFieldsNow.push('mute');
    if (pc.subs !== phone.subs) divergentFieldsNow.push('subs');
    if (pc.marathon !== phone.marathon) divergentFieldsNow.push('marathon');

    // Registrar rachas de divergencia por campo
    for (const f of fieldKeys) {
      const isDiv = divergentFieldsNow.includes(f);
      const st = fieldStreaks[f];
      if (isDiv) {
        if (!st.inStreak) {
          st.inStreak = true;
          st.startTs = ts;
        }
      } else {
        if (st.inStreak) {
          st.inStreak = false;
          st.durations.push(ts - st.startTs);
        }
      }
    }

    // Comprobar si hay divergencia significativa (> 2s en tiempo o campo desincronizado con antigüedad)
    const isOver2s = timeDiff > 2.0;
    if (isOver2s) {
      divergencesOver2s++;
    }

    // Puntaje de severidad para top 10
    if (timeDiff > 1.5 || divergentFieldsNow.length > 0) {
      let probableCause = 'Latencia de red / propagación normal';
      if (phone.age > 3000) {
        probableCause = `Corte o falta de emisión desde PC (age=${phone.age}ms > 3s)`;
      } else if (divergentFieldsNow.includes('playing')) {
        probableCause = 'Acción optimista de play/pause no reconciliada';
      } else if (divergentFieldsNow.includes('capitulo') || divergentFieldsNow.includes('titulo')) {
        probableCause = 'Cambio de capítulo o título aún no sincronizado';
      } else if (timeDiff > 4.0) {
        probableCause = 'Salto temporal (seek) manual o desfase acumulado';
      } else if (pc.stateSeq !== phone.stateSeq) {
        probableCause = `Secuencia desfasada (PC=${pc.stateSeq}, Cel=${phone.stateSeq})`;
      }

      const severityScore = timeDiff * 2 + divergentFieldsNow.length * 3 + (phone.age > 2000 ? 5 : 0);

      moments.push({
        hora: pc.hora,
        timestamp: pc.timestamp,
        timeDiffSec: Number(timeDiff.toFixed(2)),
        divergentFields: divergentFieldsNow,
        probableCause,
        pcSample: pc,
        phoneSample: phone,
        severityScore,
      });
    }
  }

  // Cerrar rachas abiertas
  for (const f of fieldKeys) {
    const st = fieldStreaks[f];
    if (st.inStreak && paired.length > 0) {
      const lastTs = paired[paired.length - 1].pc.timestamp;
      st.durations.push(lastTs - st.startTs);
    }
  }

  const fieldDivergences: FieldDivergenceStat[] = fieldKeys.map((f) => {
    const st = fieldStreaks[f];
    const count = st.durations.length;
    const totalMs = st.durations.reduce((a, b) => a + b, 0);
    const maxMs = st.durations.length > 0 ? Math.max(...st.durations) : 0;
    return {
      field: f,
      divergenceCount: count,
      totalDurationMs: totalMs,
      maxDurationMs: maxMs,
    };
  });

  // Ordenar peores momentos de mayor a menor severidad y tomar top 10
  moments.sort((a, b) => b.severityScore - a.severityScore);
  const top10 = moments.slice(0, 10).map(({ severityScore, ...rest }) => rest);

  const meanTimeDiff = Number((totalTimeDiff / paired.length).toFixed(2));
  const maxDiff = Number(maxTimeDiff.toFixed(2));
  const durationSec = Math.round((paired[paired.length - 1].pc.timestamp - paired[0].pc.timestamp) / 1000);

  // Criterio de pase: divergencias de más de 2 s deben ser 0 y diferencia media de tiempo < 2 s
  const pass = divergencesOver2s === 0 && meanTimeDiff < 2.0;

  return {
    timestamp: new Date().toISOString(),
    durationSec,
    totalSamples: paired.length,
    meanTimeDiffSec: meanTimeDiff,
    maxTimeDiffSec: maxDiff,
    divergencesOver2sCount: divergencesOver2s,
    fieldDivergences,
    top10WorstMoments: top10,
    summaryStatus: pass ? 'PASA' : 'FALLA',
  };
}
