/**
 * src/ui/LayoutDebug.tsx
 * Diagnóstico visible activado con ?debug=layout o sessionStorage 'cinecast_debug_layout'.
 * Muestra franja fija superior con métricas de viewport, rects y estilos de html/body.
 * Envía snapshot a /api/client-log cuando cambia (máx 1 req/s).
 */
import React, { useEffect, useState, useRef } from 'react';

export const LayoutDebug: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const hasParam = window.location.search.includes('debug=layout');
    if (hasParam) {
      sessionStorage.setItem('cinecast_debug_layout', '1');
      return true;
    }
    return sessionStorage.getItem('cinecast_debug_layout') === '1';
  });

  const [info, setInfo] = useState<Record<string, any>>({});
  const lastSentRef = useRef<number>(0);
  const lastPayloadRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;

    const collect = () => {
      const vv = window.visualViewport;
      const docEl = document.documentElement;
      const body = document.body;
      const htmlStyle = window.getComputedStyle(docEl);
      const bodyStyle = window.getComputedStyle(body);

      const tabbarEl = document.querySelector('nav[aria-label="Navegación móvil"]');
      const tabbarRect = tabbarEl ? tabbarEl.getBoundingClientRect() : null;

      const miniRemoteEl = document.querySelector('aside[aria-label*="Mini control remoto"]');
      const miniRemoteRect = miniRemoteEl ? miniRemoteEl.getBoundingClientRect() : null;

      const snapshot = {
        innerHeight: window.innerHeight,
        vvHeight: vv ? vv.height : null,
        vvOffsetTop: vv ? vv.offsetTop : null,
        vvScale: vv ? vv.scale : null,
        clientHeight: docEl.clientHeight,
        scrollY: window.scrollY,
        tabbar: tabbarRect
          ? { top: Math.round(tabbarRect.top), bottom: Math.round(tabbarRect.bottom) }
          : null,
        miniRemote: miniRemoteRect
          ? { top: Math.round(miniRemoteRect.top), bottom: Math.round(miniRemoteRect.bottom) }
          : null,
        html: {
          overflow: htmlStyle.overflow,
          position: htmlStyle.position,
          top: htmlStyle.top,
          height: htmlStyle.height,
          padding: htmlStyle.padding,
        },
        body: {
          overflow: bodyStyle.overflow,
          position: bodyStyle.position,
          top: bodyStyle.top,
          height: bodyStyle.height,
          padding: bodyStyle.padding,
        },
      };

      setInfo(snapshot);

      // Enviar a /api/client-log si cambió y máximo 1 por segundo
      const payloadStr = JSON.stringify(snapshot);
      const now = Date.now();
      if (payloadStr !== lastPayloadRef.current && now - lastSentRef.current >= 1000) {
        lastSentRef.current = now;
        lastPayloadRef.current = payloadStr;
        try {
          fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              level: 'info',
              message: 'layout-debug-snapshot',
              data: snapshot,
            }),
          }).catch(() => {});
        } catch (_) {}
      }
    };

    collect();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', collect);
      vv.addEventListener('scroll', collect);
    }
    window.addEventListener('load', collect);
    window.addEventListener('resize', collect);
    window.addEventListener('scroll', collect, { passive: true });
    window.addEventListener('pageshow', collect);
    window.addEventListener('popstate', collect);

    const interval = setInterval(collect, 1000);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', collect);
        vv.removeEventListener('scroll', collect);
      }
      window.removeEventListener('load', collect);
      window.removeEventListener('resize', collect);
      window.removeEventListener('scroll', collect);
      window.removeEventListener('pageshow', collect);
      window.removeEventListener('popstate', collect);
      clearInterval(interval);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside
      aria-label="Diagnóstico de layout"
      className="fixed top-0 inset-x-0 z-[99999] bg-black/90 text-emerald-400 font-mono text-[10px] leading-tight px-2 py-1 select-none pointer-events-none border-b border-emerald-500/40 shadow-lg truncate"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span>iH:{info.innerHeight}</span>
        <span>vvH:{info.vvHeight != null ? Math.round(info.vvHeight) : '-'}</span>
        <span>vvTop:{info.vvOffsetTop != null ? Math.round(info.vvOffsetTop) : '-'}</span>
        <span>scale:{info.vvScale != null ? info.vvScale.toFixed(2) : '-'}</span>
        <span>cH:{info.clientHeight}</span>
        <span>sY:{Math.round(info.scrollY || 0)}</span>
        <span>bar:[{info.tabbar?.top ?? '-'}:{info.tabbar?.bottom ?? '-'}]</span>
        {info.miniRemote && <span>mini:[{info.miniRemote.top}:{info.miniRemote.bottom}]</span>}
        <span>html:{info.html?.overflow || 'auto'}</span>
        <span>body:{info.body?.overflow || 'auto'}</span>
      </div>
    </aside>
  );
};

