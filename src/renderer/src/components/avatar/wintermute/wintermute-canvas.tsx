/**
 * Placeholder until the Three.js renderer lands (Phase 3). Draws nothing but
 * a static charcoal disc so the renderer switch is visible in the UI.
 */
export function WintermuteCanvas(): JSX.Element {
  return (
    <div
      data-testid="wintermute-canvas"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 'min(28vmin, 220px)',
          height: 'min(28vmin, 220px)',
          borderRadius: '50%',
          background: '#171a1e',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '14%',
            right: '14%',
            top: '42%',
            height: '5.5%',
            borderRadius: '999px',
            background: '#7fd8ff',
            opacity: 0.78,
          }}
        />
      </div>
    </div>
  );
}
