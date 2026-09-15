/* eslint-disable func-names */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-console */
/**
 * Live2D side of speech: Talk motion, expression and wav-driven lip sync.
 *
 * This is the code that used to live inside the audio task. It now listens
 * to the renderer-neutral playback service, so audio plays whether or not a
 * Live2D model exists. Mounted only by the Live2D canvas.
 */
import { useEffect } from 'react';
import { useLive2DExpression } from '@/hooks/canvas/use-live2d-expression';
import {
  audioPlaybackService,
  SpeechAdapter,
  SpeechEndReason,
} from '@/services/audio-playback-service';
import * as LAppDefine from '../../../WebSDK/src/lappdefine';

type Live2DModel = any;

const LIP_SYNC_SCALE = 2.0;

function resetWavHandler(model: Live2DModel): void {
  if (!model) {
    console.log('No associated model found to stop lip sync.');
    return;
  }
  if (!model._wavFileHandler) {
    console.warn('Current model does not have _wavFileHandler to stop/reset.');
    return;
  }
  try {
    // Release PCM data to stop lip sync calculation in update()
    model._wavFileHandler.releasePcmData();
    model._wavFileHandler._lastRms = 0.0;
    model._wavFileHandler._sampleOffset = 0;
    model._wavFileHandler._userTimeSeconds = 0.0;
  } catch (e) {
    console.error('Error stopping/resetting wavFileHandler:', e);
  }
}

export const useLive2DSpeechAdapter = (): void => {
  const { setExpression } = useLive2DExpression();

  useEffect(() => {
    let currentModel: Live2DModel | null = null;

    const adapter: SpeechAdapter = {
      onSpeechStart({ request, audioDataUrl }) {
        const live2dManager = (window as any).getLive2DManager?.();
        if (!live2dManager) {
          console.warn('Live2D manager not found; speech plays without lip sync');
          return;
        }
        const model = live2dManager.getModel(0);
        if (!model) {
          console.warn('Live2D model not found at index 0; speech plays without lip sync');
          return;
        }
        currentModel = model;

        const lappAdapter = (window as any).getLAppAdapter?.();
        const expression = request.expressions?.[0];
        if (lappAdapter && expression !== undefined) {
          setExpression(expression, lappAdapter, `Set expression to: ${expression}`);
        }

        if (LAppDefine && LAppDefine.PriorityNormal) {
          model.startRandomMotion('Talk', LAppDefine.PriorityNormal);
        } else {
          console.warn('LAppDefine.PriorityNormal not found - cannot start talk motion');
        }

        if (!model._wavFileHandler) {
          console.warn('Model does not have _wavFileHandler for lip sync');
          return;
        }
        if (!model._wavFileHandler._initialized) {
          model._wavFileHandler._initialized = true;
          const originalUpdate = model._wavFileHandler.update.bind(model._wavFileHandler);
          model._wavFileHandler.update = function (deltaTimeSeconds: number) {
            const result = originalUpdate(deltaTimeSeconds);
            // @ts-ignore
            this._lastRms = Math.min(2.0, this._lastRms * LIP_SYNC_SCALE);
            return result;
          };
        }
        model._wavFileHandler.start(audioDataUrl);
      },

      onSpeechEnd(reason: SpeechEndReason) {
        // On a natural end the wav handler runs out of PCM by itself, as before.
        if (reason !== 'ended') {
          resetWavHandler(currentModel);
        }
        currentModel = null;
      },
    };

    return audioPlaybackService.registerSpeechAdapter(adapter);
  }, [setExpression]);
};
