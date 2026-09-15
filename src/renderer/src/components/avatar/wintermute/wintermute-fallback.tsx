/**
 * Static stand-in when WebGL is unavailable or the context is lost: the same
 * silhouette in plain CSS, so the UI keeps its shape and chat/audio go on.
 */
interface WintermuteFallbackProps {
  reason?: string;
}

export function WintermuteFallback({ reason }: WintermuteFallbackProps): JSX.Element {
  return (
    <div
      data-testid="wintermute-fallback"
      title={reason}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: '55%',
          aspectRatio: '1 / 1',
          maxWidth: '100%',
          maxHeight: '100%',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 32%, #262a30 0%, #171a1e 55%, #0b0d10 100%)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '14%',
            right: '14%',
            top: '43%',
            height: '5%',
            borderRadius: '999px',
            background: '#7fd8ff',
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
}
