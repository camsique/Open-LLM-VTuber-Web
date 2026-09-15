/**
 * The upstream Live2D canvas behind the renderer switch. Untouched
 * behaviour; exists so App.tsx no longer names Live2D directly.
 */
import { Live2D } from '@/components/canvas/live2d';

export function Live2DAvatar(): JSX.Element {
  return <Live2D />;
}
