/**
 * Which component draws the avatar. Kept free of React so config code and
 * tests can import it.
 */
export const AVATAR_RENDERER_KINDS = ['live2d', 'wintermute'] as const;

export type AvatarRendererKind = (typeof AVATAR_RENDERER_KINDS)[number];

export const DEFAULT_AVATAR_RENDERER: AvatarRendererKind = 'wintermute';

export function isAvatarRendererKind(value: unknown): value is AvatarRendererKind {
  return typeof value === 'string'
    && (AVATAR_RENDERER_KINDS as readonly string[]).includes(value);
}
