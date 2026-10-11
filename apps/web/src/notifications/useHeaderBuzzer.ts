import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmationSoundDecision, type ChimeLevel, type ChimeRequest } from './notificationStore';

export interface HeaderBuzzerState {
  readonly category: ChimeRequest['category'] | null;
  readonly feedKey: string | null;
  readonly level: ChimeLevel | null;
}

const AUDIO_BY_LEVEL: Record<ChimeLevel, string> = {
  2: '/audio/2.wav',
  3: '/audio/3.wav',
  4: '/audio/4.wav',
  5: '/audio/5.wav',
};

export function useHeaderBuzzer(): {
  readonly state: HeaderBuzzerState;
  readonly request: (request: ChimeRequest) => void;
  readonly stop: () => void;
  readonly confirmLevel: (level: ChimeLevel) => void;
} {
  const [state, setState] = useState<HeaderBuzzerState>({
    category: null,
    feedKey: null,
    level: null,
  });
  const stateRef = useRef(state);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationRef = useRef(0);
  const playbackBlockedRef = useRef(false);
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const generation = generationRef.current;
    void audio.play().then(
      () => {
        if (generation === generationRef.current) playbackBlockedRef.current = false;
      },
      () => {
        if (generation === generationRef.current) playbackBlockedRef.current = true;
      },
    );
  }, []);
  const stop = useCallback(() => {
    generationRef.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;
    playbackBlockedRef.current = false;
    const stopped = { category: null, feedKey: null, level: null } as const;
    stateRef.current = stopped;
    setState(stopped);
  }, []);
  const request = useCallback(
    ({ category, feedKey, level }: ChimeRequest) => {
      const current = stateRef.current.level;
      if (current !== null && current >= level) return;
      stop();
      const audio = new Audio(AUDIO_BY_LEVEL[level]);
      audio.loop = true;
      audioRef.current = audio;
      play();
      const next = { category, feedKey, level };
      stateRef.current = next;
      setState(next);
    },
    [play, stop],
  );
  useEffect(() => {
    const retry = () => {
      if (playbackBlockedRef.current) play();
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
    return () => {
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
    };
  }, [play]);
  useEffect(() => stop, [stop]);
  const confirmLevel = useCallback(
    (level: ChimeLevel) => {
      if (confirmationSoundDecision(stateRef.current.level, level) === 'stop') stop();
    },
    [stop],
  );
  return { state, request, stop, confirmLevel };
}
