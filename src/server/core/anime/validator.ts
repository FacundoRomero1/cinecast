import { hlsduration } from '@eyevinn/hls-duration';
import { parse as parseHls } from '@skax/hls-parse';

/**
 * Validador de Duración HLS (Backend)
 * Descarga el manifiesto .m3u8 y calcula su duración total.
 * Compara la duración real contra expectedMinutes * 60 aplicando una tolerancia del 20%.
 * Si la duración es menor a 60 segundos o la diferencia excede el 20%, descarta el stream retornando false.
 */
export async function validateStreamDuration(
  m3u8Url: string,
  expectedMinutes: number = 24
): Promise<boolean> {
  if (!m3u8Url || typeof m3u8Url !== 'string') return false;

  const expectedSeconds = (expectedMinutes || 24) * 60;
  const minAllowed = expectedSeconds * 0.8; // Tolerancia -20%
  const maxAllowed = expectedSeconds * 1.2; // Tolerancia +20%

  let durationSeconds = 0;

  try {
    // 1. Descargar primero el contenido del manifiesto
    const res = await fetch(m3u8Url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[StreamValidator] Error HTTP ${res.status} al descargar manifiesto: ${m3u8Url}`);
      return false;
    }

    const text = await res.text();

    // Si la respuesta no contiene la cabecera HLS #EXTM3U, no es un stream válido (ej. HTML de anuncio o captcha)
    if (!text.includes('#EXTM3U')) {
      console.warn(`[StreamValidator] Falso positivo rechazado: no es un manifiesto HLS (#EXTM3U no encontrado en respuesta)`);
      return false;
    }

    // 2. Si es una lista maestra con variantes (#EXT-X-STREAM-INF), intentar cálculo con @eyevinn/hls-duration
    if (text.includes('#EXT-X-STREAM-INF')) {
      try {
        const parsedUrl = new URL(m3u8Url);
        const dur = await Promise.race([
          hlsduration(parsedUrl),
          new Promise<number>((_, reject) => setTimeout(() => reject(new Error('Timeout hlsduration')), 5000)),
        ]);
        if (typeof dur === 'number' && !isNaN(dur) && dur > 0) {
          durationSeconds = dur;
        }
      } catch (_) {
        // Si hlsduration falla, el cálculo continuará mediante @skax/hls-parse abajo
      }
    }

    // 3. Si no es lista maestra o si hlsduration no resolvió duración, calcular con @skax/hls-parse
    if (durationSeconds <= 0) {
      const parsed = parseHls(text);

      if (parsed && !parsed.isMasterPlaylist && Array.isArray((parsed as any).segments)) {
        durationSeconds = (parsed as any).segments.reduce(
          (acc: number, seg: any) => acc + (seg.duration || 0),
          0
        );
      } else if (parsed && parsed.isMasterPlaylist && Array.isArray((parsed as any).variants)) {
        // En master playlist, consultar la primera variante para obtener la lista de segmentos
        const firstVariantUri = (parsed as any).variants[0]?.uri;
        if (firstVariantUri) {
          const subUrl = new URL(firstVariantUri, m3u8Url).href;
          const subRes = await fetch(subUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: '*/*',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (subRes.ok) {
            const subText = await subRes.text();
            const subParsed = parseHls(subText);
            if (subParsed && Array.isArray((subParsed as any).segments)) {
              durationSeconds = (subParsed as any).segments.reduce(
                (acc: number, seg: any) => acc + (seg.duration || 0),
                0
              );
            }
          }
        }
      }
    }

    console.log(
      `[StreamValidator] Stream: ${m3u8Url.slice(0, 65)}... | Duración real: ${Math.round(durationSeconds)}s | Esperada: ${Math.round(expectedSeconds)}s (Rango 20%: ${Math.round(minAllowed)}s - ${Math.round(maxAllowed)}s)`
    );

    // Si la duración es menor a 60 segundos, es anuncio o clip promocional basura
    if (durationSeconds < 60) {
      console.warn(`[StreamValidator] Falso positivo rechazado: duración menor a 60s (${Math.round(durationSeconds)}s)`);
      return false;
    }

    // Compara la duración real contra expectedMinutes * 60 con margen del 20%
    if (durationSeconds < minAllowed || durationSeconds > maxAllowed) {
      console.warn(
        `[StreamValidator] Falso positivo rechazado: duración ${Math.round(durationSeconds)}s fuera del margen permitido (${Math.round(minAllowed)}s - ${Math.round(maxAllowed)}s)`
      );
      return false;
    }

    console.log(`[StreamValidator] Stream validado exitosamente: ${Math.round(durationSeconds)}s dentro del margen.`);
    return true;
  } catch (err: any) {
    console.warn(`[StreamValidator] Error en validación de stream para ${m3u8Url}:`, err?.message || err);
    return false;
  }
}
