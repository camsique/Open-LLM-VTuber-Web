/**
 * Compatibility wrapper. Playback now lives in AudioPlaybackProvider
 * (`@/context/audio-playback-context`); this hook keeps the old call sites
 * working and no longer depends on Live2D.
 */
import { useAudioPlayback } from '@/context/audio-playback-context';

export type { AudioTaskOptions } from '@/context/audio-playback-context';

export const useAudioTask = () => {
  const { addAudioTask, appendResponse, stopCurrentAudioAndLipSync } = useAudioPlayback();
  return {
    addAudioTask,
    appendResponse,
    stopCurrentAudioAndLipSync,
  };
};
