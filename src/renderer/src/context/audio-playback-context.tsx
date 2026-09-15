/* eslint-disable no-console */
/**
 * The single owner of TTS playback side effects for the whole app.
 *
 * Exactly one instance exists (mounted in App.tsx above WebSocketHandler),
 * which is what makes interruption and `frontend-playback-complete`
 * reliable: previously every `useAudioTask()` call had its own copy of the
 * "current audio" and of the completion effect.
 *
 * Nothing here knows about Live2D. Renderers attach to
 * `audioPlaybackService` themselves.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { toaster } from '@/components/ui/toaster';
import { wsService, DisplayText } from '@/services/websocket-service';
import {
  audioPlaybackService,
  PlaybackState,
} from '@/services/audio-playback-service';

export interface AudioTaskOptions {
  audioBase64: string;
  volumes: number[];
  sliceLength: number;
  displayText?: DisplayText | null;
  expressions?: string[] | number[] | null;
  speaker_uid?: string;
  forwarded?: boolean;
}

export interface AudioPlaybackContextType {
  /** Queue one sentence (text side effects + audio). */
  addAudioTask: (options: AudioTaskOptions) => Promise<void>;
  /** Stop the sentence that is loading or playing right now. */
  stopCurrentAudio: () => void;
  /** Legacy name kept for existing callers. */
  stopCurrentAudioAndLipSync: () => void;
  appendResponse: (text: string) => void;
}

const AudioPlaybackContext = createContext<AudioPlaybackContextType | null>(null);

export function AudioPlaybackProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const { aiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setSubtitleText } = useSubtitle();
  const { appendResponse, appendAIMessage } = useChatHistory();

  // Latest values for use inside queued tasks without stale closures.
  const stateRef = useRef({ aiState, setSubtitleText, appendResponse, appendAIMessage });
  stateRef.current = { aiState, setSubtitleText, appendResponse, appendAIMessage };

  const isInterrupted = useCallback(() => stateRef.current.aiState === 'interrupted', []);

  const stopCurrentAudio = useCallback(() => {
    audioPlaybackService.stop();
  }, []);

  const runAudioTask = useCallback(async (options: AudioTaskOptions): Promise<void> => {
    const {
      setSubtitleText: updateSubtitle,
      appendResponse: appendText,
      appendAIMessage: appendAI,
    } = stateRef.current;

    if (isInterrupted()) {
      console.warn('Audio playback blocked by interruption state.');
      return;
    }

    const {
      audioBase64, volumes, sliceLength, displayText, expressions, forwarded, speaker_uid: speakerUid,
    } = options;

    if (displayText) {
      appendText(displayText.text);
      appendAI(displayText.text, displayText.name, displayText.avatar);
      if (audioBase64) {
        updateSubtitle(displayText.text);
      }
      if (!forwarded) {
        wsService.sendMessage({
          type: 'audio-play-start',
          display_text: displayText,
          forwarded: true,
        });
      }
    }

    if (!audioBase64) return;

    try {
      await audioPlaybackService.play({
        audioBase64,
        volumes,
        sliceLengthMs: sliceLength,
        displayText,
        forwarded,
        expressions,
        speakerUid,
      }, { shouldCancel: isInterrupted });
    } catch (error) {
      console.error('Audio playback setup error:', error);
      toaster.create({
        title: `${t('error.audioPlayback')}: ${error}`,
        type: 'error',
        duration: 2000,
      });
    }
  }, [isInterrupted, t]);

  const addAudioTask = useCallback(async (options: AudioTaskOptions) => {
    if (isInterrupted()) {
      console.log('Skipping audio task due to interrupted state');
      return;
    }
    console.log(`Adding audio task ${options.displayText?.text} to queue`);
    audioTaskQueue.addTask(() => runAudioTask(options));
  }, [isInterrupted, runAudioTask]);

  // Backend finished synthesising: once the local queue drains, tell it so.
  useEffect(() => {
    if (!backendSynthComplete) return undefined;
    let isMounted = true;

    (async () => {
      await audioTaskQueue.waitForCompletion();
      if (!isMounted) return;
      audioPlaybackService.stop();
      wsService.sendMessage({ type: 'frontend-playback-complete' });
      setBackendSynthComplete(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, setBackendSynthComplete]);

  const value = useMemo<AudioPlaybackContextType>(() => ({
    addAudioTask,
    stopCurrentAudio,
    stopCurrentAudioAndLipSync: stopCurrentAudio,
    appendResponse,
  }), [addAudioTask, stopCurrentAudio, appendResponse]);

  return (
    <AudioPlaybackContext.Provider value={value}>
      {children}
    </AudioPlaybackContext.Provider>
  );
}

export function useAudioPlayback(): AudioPlaybackContextType {
  const ctx = useContext(AudioPlaybackContext);
  if (!ctx) {
    throw new Error('useAudioPlayback must be used within an AudioPlaybackProvider');
  }
  return ctx;
}

/** Coarse playback state for React (isPlaying, sentence sequence). */
export function useAudioPlaybackState(): PlaybackState {
  return useSyncExternalStore(
    audioPlaybackService.subscribe,
    audioPlaybackService.getPlaybackState,
    audioPlaybackService.getPlaybackState,
  );
}
