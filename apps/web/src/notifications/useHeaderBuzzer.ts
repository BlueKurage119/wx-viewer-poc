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
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setState({ category: null, feedKey: null });
  }, []);
  const request = useCallback(
    ({ category, feedKey }: ChimeRequest) => {
      const current = stateRef.current.category;
      if (current && priority[current] >= priority[category]) return;
      stop();
      const audio = new Audio(AUDIO_BY_CATEGORY[category]);
      audio.loop = true;
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
      setState({ category, feedKey });
    },
    [stop],
  );
  useEffect(() => stop, [stop]);
  return { state, request, stop };
}
