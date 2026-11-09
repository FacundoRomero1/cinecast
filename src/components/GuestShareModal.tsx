import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, Users, Sparkles, QrCode, Smartphone, Wifi } from 'lucide-react';
import { deviceSync } from '../services/deviceSync';

interface GuestShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  screenName: string;
}

export const GuestShareModal: React.FC<GuestShareModalProps> = ({
  isOpen,
  onClose,
  roomId,
  screenName,
}) => {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [pairingUrl, setPairingUrl] = useState<string>(() => deviceSync.getPairingUrl('remote'));
  const [lanIp, setLanIp] = useState<string>(() => deviceSync.getLanIp());

  useEffect(() => {
    if (!isOpen) return;

    deviceSync.fetchLocalIp().then((ip) => {
      setLanIp(ip);
      const url = deviceSync.getPairingUrl('remote');
      setPairingUrl(url);

      QRCode.toDataURL(url, {
        width: 240,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then(setQrCodeDataUrl)
        .catch(console.error);
    });
  }, [isOpen, roomId]);

  if (!isOpen) return null;

  const copyToClipboard = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Fijo */}
        <div className="shrink-0 px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Vincular Celular / Invitados</h3>
              <p className="text-[11px] text-zinc-400">
                Pantalla: <strong className="text-zinc-200">{screenName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cuerpo Scrolleable */}
        <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar text-center">
          <p className="text-xs text-zinc-400">
            Escaneá con la cámara de tu celular para abrir el control remoto y manejar películas, series, Spotify o YouTube:
          </p>

          {/* QR Code Container (Compacto w-40 h-40) */}
          <div className="py-1">
            <div className="p-3 bg-white rounded-2xl inline-block shadow-xl">
              {qrCodeDataUrl ? (
                <img src={qrCodeDataUrl} alt="QR para invitados" className="w-40 h-40 rounded-xl object-contain mx-auto" />
              ) : (
                <div className="w-40 h-40 flex items-center justify-center text-zinc-500 text-xs">
                  Generando código QR...
                </div>
              )}
            </div>
          </div>

          {/* LAN IP Info for direct WiFi Pairing (Sin 127.0.0.1) */}
          <div className="px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <Wifi className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Red Local WiFi:</span>
            </div>
            <span className="font-mono text-white font-bold">
              {lanIp && lanIp !== '127.0.0.1' ? `${lanIp}:3000` : 'Buscando IP WiFi...'}
            </span>
          </div>

          {/* PIN & Room Info */}
          <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center justify-between">
            <div className="text-left">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Código de Sala</span>
              <div className="font-mono text-sm font-black text-red-500">{roomId}</div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800/50 text-emerald-400 text-[11px] font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Conexión Instantánea
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            <button
              onClick={copyToClipboard}
              className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-red-900/30"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>¡Enlace copiado al portapapeles!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copiar enlace directo de control</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-semibold text-xs transition"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
