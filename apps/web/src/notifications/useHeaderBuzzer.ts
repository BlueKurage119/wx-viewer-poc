import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChimeRequest } from './notificationStore';

export interface HeaderBuzzerState {
  readonly category: ChimeRequest['category'] | null;
  readonly feedKey: string | null;
}

const AUDIO_BY_CATEGORY: Record<NonNullable<HeaderBuzzerState['category']>, string> = {
  warning: '/audio/2.wav',
  question: '/audio/4.wav',
  emergency: '/audio/5.wav',
};
const priority = { warning: 1, question: 2, emergency: 3 } as const;

export function useHeaderBuzzer(): {
  readonly state: HeaderBuzzerState;
  readonly request: (request: ChimeRequest) => void;
  readonly stop: () => void;
} {
  const [state, setState] = useState<HeaderBuzzerState>({ category: null, feedKey: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackBlockedRef = useRef(false);
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(
      () => {
        playbackBlockedRef.current = false;
      },
      () => {
        playbackBlockedRef.current = true;
      },
    );
  }, []);
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    playbackBlockedRef.current = false;
    const stopped = { category: null, feedKey: null } as const;
    stateRef.current = stopped;
    setState(stopped);
  }, []);
  const request = useCallback(
    ({ category, feedKey }: ChimeRequest) => {
      const current = stateRef.current.category;
      if (current && priority[current] >= priority[category]) return;
      stop();
      const audio = new Audio(AUDIO_BY_CATEGORY[category]);
      audio.loop = true;
      audioRef.current = audio;
      play();
      const next = { category, feedKey };
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
  return { state, request, stop };
}
