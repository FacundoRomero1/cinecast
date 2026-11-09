import React from 'react';
import { AudioSettings, AudioPreset, PlaybackSettings } from '../types';
import { Volume2, VolumeX, Sliders, Moon, Mic, Sparkles, Disc, Check, X, FastForward, PlayCircle } from 'lucide-react';

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioSettings: AudioSettings;
  playbackSettings: PlaybackSettings;
  onUpdateAudio: (settings: Partial<AudioSettings>) => void;
  onUpdatePlayback: (settings: Partial<PlaybackSettings>) => void;
  targetDeviceName?: string;
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({
  isOpen,
  onClose,
  audioSettings,
  playbackSettings,
  onUpdateAudio,
  onUpdatePlayback,
  targetDeviceName = 'PC / Pantalla',
}) => {
  if (!isOpen) return null;

  const presets: { id: AudioPreset; title: string; desc: string; icon: any; color: string }[] = [
    {
      id: 'vocal_boost',
      title: 'Realce de Voces',
      desc: 'Diálogos nítidos y claros, reduce retumbes molestos.',
      icon: Mic,
      color: 'from-amber-500 to-orange-600',
    },
    {
      id: 'night_mode',
      title: 'Modo Nocturno',
      desc: 'Compresor dinámico: atenúa explosiones y eleva susurros para no despertar a nadie.',
      icon: Moon,
      color: 'from-indigo-500 to-purple-600',
    },
    {
      id: 'bass_boost',
      title: 'Graves Cine (Bass)',
      desc: 'Sonido profundo e impactante estilo sala de cine IMAX.',
      icon: Disc,
      color: 'from-red-600 to-rose-700',
    },
    {
      id: 'cinematic_surround',
      title: 'Cine Envolvente',
      desc: 'Espacialización estéreo acústica amplia.',
      icon: Sparkles,
      color: 'from-blue-600 to-cyan-600',
    },
    {
      id: 'standard',
      title: 'Estándar',
      desc: 'Respuesta acústica original sin procesado.',
      icon: Sliders,
      color: 'from-zinc-700 to-zinc-600',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Fijo */}
        <div className="shrink-0 px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-red-500" />
            <div>
              <h3 className="font-bold text-sm text-white">Audio & Reproducción Inteligente</h3>
              <p className="text-[11px] text-zinc-400">Controlando: <span className="text-red-400 font-medium">{targetDeviceName}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Master Volume with Booster */}
          <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                {audioSettings.isMuted ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-zinc-400" />
                )}
                Volumen Maestro
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${audioSettings.volume > 100 ? 'text-red-400' : 'text-zinc-200'}`}>
                  {audioSettings.isMuted ? 'Silenciado' : `${audioSettings.volume}%`}
                  {audioSettings.volume > 100 && ' (Boost)'}
                </span>
                <button
                  onClick={() => onUpdateAudio({ isMuted: !audioSettings.isMuted })}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                    audioSettings.isMuted 
                      ? 'bg-red-600 text-white' 
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {audioSettings.isMuted ? 'Desmutear' : 'Silenciar'}
                </button>
              </div>
            </div>

            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="150"
                value={audioSettings.isMuted ? 0 : audioSettings.volume}
                onChange={(e) => onUpdateAudio({ volume: Number(e.target.value), isMuted: false })}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-600"
              />
            </div>
            <div className="flex justify-between text-[11px] text-zinc-500 mt-1 font-mono">
              <span>0%</span>
              <span>50%</span>
              <span>100% (Normal)</span>
              <span className="text-red-400 font-semibold">150% (Amplificado)</span>
            </div>
          </div>

          {/* Audio Presets */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2.5">
              Efectos de Audio & Perfiles
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {presets.map((p) => {
                const Icon = p.icon;
                const isSelected = audioSettings.preset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => onUpdateAudio({ preset: p.id })}
                    className={`text-left p-3 rounded-xl border transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-zinc-800/90 border-red-500 ring-1 ring-red-500/50'
                        : 'bg-zinc-950/40 border-zinc-800/80 hover:bg-zinc-800/40 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${p.color} text-white`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-sm text-zinc-100">{p.title}</span>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-red-500" />}
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{p.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manual EQ Sliders (only if preset is standard or fine tuning) */}
          <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Ecualizador Manual de 3 Bandas
              </span>
              {audioSettings.preset !== 'standard' && (
                <span className="text-[11px] text-amber-400 font-medium">
                  (Modificado por perfil actual)
                </span>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-300">
                  <span>Graves (Bass)</span>
                  <span className="font-mono text-zinc-400">{audioSettings.bassGain > 0 ? `+${audioSettings.bassGain}` : audioSettings.bassGain} dB</span>
                </div>
                <input
                  type="range"
                  min="-10"
                  max="12"
                  value={audioSettings.bassGain}
                  onChange={(e) => onUpdateAudio({ bassGain: Number(e.target.value), preset: 'standard' })}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-300">
                  <span>Medios / Voces (Diálogos)</span>
                  <span className="font-mono text-zinc-400">{audioSettings.midGain > 0 ? `+${audioSettings.midGain}` : audioSettings.midGain} dB</span>
                </div>
                <input
                  type="range"
                  min="-10"
                  max="12"
                  value={audioSettings.midGain}
                  onChange={(e) => onUpdateAudio({ midGain: Number(e.target.value), preset: 'standard' })}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-300">
                  <span>Agudos / Claridad</span>
                  <span className="font-mono text-zinc-400">{audioSettings.trebleGain > 0 ? `+${audioSettings.trebleGain}` : audioSettings.trebleGain} dB</span>
                </div>
                <input
                  type="range"
                  min="-10"
                  max="12"
                  value={audioSettings.trebleGain}
                  onChange={(e) => onUpdateAudio({ trebleGain: Number(e.target.value), preset: 'standard' })}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                />
              </div>
            </div>
          </div>

          {/* Autoplay & Skip Intro Configurations */}
          <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800 space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
              Configuración de Maratón & Series
            </label>

            <div className="flex items-center justify-between">
              <div className="flex items-start gap-2.5">
                <PlayCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-zinc-200">Pasar episodios automáticamente</p>
                  <p className="text-xs text-zinc-400">Reproduce el siguiente episodio sin tocar nada al terminar.</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={playbackSettings.autoPlayNext}
                onChange={(e) => onUpdatePlayback({ autoPlayNext: e.target.checked })}
                className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 text-red-600 focus:ring-red-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
              <div className="flex items-start gap-2.5">
                <FastForward className="w-4 h-4 text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-zinc-200">Saltar intros automáticamente</p>
                  <p className="text-xs text-zinc-400">Se salta la introducción apenas comienza de forma inteligente.</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={playbackSettings.autoSkipIntro}
                onChange={(e) => onUpdatePlayback({ autoSkipIntro: e.target.checked })}
                className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 text-red-600 focus:ring-red-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-zinc-950/90 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
