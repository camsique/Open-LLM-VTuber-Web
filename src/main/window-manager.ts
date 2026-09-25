import {
  BrowserWindow, screen, shell, ipcMain, app,
} from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { is } from '@electron-toolkit/utils';
import {
  Point, Rect, Size,
  clampToWorkAreas, defaultPetBounds, dragTo, parseStoredBounds,
  resizeKeepingTopCenter, sanitizeSize,
} from './pet-geometry';

const isMac = process.platform === 'darwin';

/**
 * How pet mode is realised.
 *  - 'overlay' (upstream): one transparent, click-through window over all
 *    displays; the renderer re-enables the mouse while hovering the avatar.
 *    Relies on setIgnoreMouseEvents' `forward`, which is macOS/Windows only,
 *    so on Linux the avatar can never be clicked.
 *  - 'compact' (Wintermute): a small always-on-top window holding only the
 *    orb (and the input box when shown). Never click-through, so it behaves
 *    the same on Windows, X11 and XWayland. The renderer drags the window.
 */
export type PetShell = 'overlay' | 'compact';

const PET_STATE_FILE = 'wintermute-pet-window.json';
const DEFAULT_COMPACT_SIZE: Size = { width: 240, height: 240 };

export class WindowManager {
  private window: BrowserWindow | null = null;

  private windowedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  private hoveringComponents: Set<string> = new Set();

  private currentMode: 'window' | 'pet' = 'window';

  // Track if mouse events are forcibly ignored
  private forceIgnoreMouse = false;

  private petShell: PetShell = 'overlay';

  /** Size the renderer last asked for in compact pet mode. */
  private compactSize: Size = { ...DEFAULT_COMPACT_SIZE };

  /** Last compact bounds (persisted, so the orb comes back where it was left). */
  private compactBounds: Rect | null = null;

  private drag: { window: Point; pointer: Point } | null = null;

  /**
   * True until the first measured size arrives for a pet window that has no
   * remembered position: that first placement uses the real size, so the
   * default bottom-right margin is kept instead of being clamped away.
   */
  private awaitingFirstPlacement = false;

  constructor() {
    ipcMain.on('renderer-ready-for-mode-change', (_event, newMode) => {
      if (newMode === 'pet') {
        setTimeout(() => {
          this.continueSetWindowModePet();
        }, 500);
      } else {
        setTimeout(() => {
          this.continueSetWindowModeWindow();
        }, 500);
      }
    });

    ipcMain.on('mode-change-rendered', () => {
      this.window?.setOpacity(1);
    });

    ipcMain.on('window-unfullscreen', () => {
      const window = this.getWindow();
      if (window && window.isFullScreen()) {
        window.setFullScreen(false);
      }
    });

    // Handle toggle force ignore mouse events from renderer
    ipcMain.on('toggle-force-ignore-mouse', () => {
      this.toggleForceIgnoreMouse();
    });

    this.compactBounds = this.loadCompactBounds();
    if (this.compactBounds) {
      this.compactSize = { width: this.compactBounds.width, height: this.compactBounds.height };
    }
  }

  // ---------------------------------------------------------------- compact pet

  private isCompactPet(): boolean {
    return this.currentMode === 'pet' && this.petShell === 'compact';
  }

  private petStatePath(): string {
    return join(app.getPath('userData'), PET_STATE_FILE);
  }

  private loadCompactBounds(): Rect | null {
    try {
      return parseStoredBounds(JSON.parse(readFileSync(this.petStatePath(), 'utf8')));
    } catch {
      return null;
    }
  }

  private saveCompactBounds(): void {
    if (!this.compactBounds) return;
    try {
      writeFileSync(this.petStatePath(), JSON.stringify(this.compactBounds));
    } catch (error) {
      console.warn('[pet] could not persist window position:', error);
    }
  }

  private workAreas(): Rect[] {
    return screen.getAllDisplays().map((d) => d.workArea);
  }

  private compactTargetBounds(): Rect {
    const base = this.compactBounds
      ? resizeKeepingTopCenter(this.compactBounds, this.compactSize)
      : defaultPetBounds(screen.getPrimaryDisplay().workArea, this.compactSize);
    return clampToWorkAreas(base, this.workAreas());
  }

  /** setBounds on a window that is otherwise kept non-resizable. */
  private applyBounds(bounds: Rect): void {
    if (!this.window) return;
    // On Linux a non-resizable window has min = max size, which would veto
    // the new size, so unlock around the change.
    this.window.setResizable(true);
    this.window.setBounds(bounds);
    this.window.setResizable(false);
    this.compactBounds = this.window.getBounds();
  }

  private applyCompactPet(): void {
    if (!this.window) return;
    this.awaitingFirstPlacement = this.compactBounds === null;
    this.hoveringComponents.clear();
    this.window.setIgnoreMouseEvents(false);
    this.applyBounds(this.compactTargetBounds());
    if (isMac) {
      this.window.setWindowButtonVisibility(false);
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    this.window.setSkipTaskbar(true);
    this.window.setFocusable(true);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.saveCompactBounds();
  }

  private applyOverlayPet(): void {
    if (!this.window) return;
    // Calculate the bounding rectangle that covers all connected displays.
    // This allows the transparent pet-mode window to span across monitors,
    // so the avatar can be dragged freely between them.
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map((d) => d.bounds.x));
    const minY = Math.min(...displays.map((d) => d.bounds.y));
    const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));

    // Resize and position the window to cover the entire virtual screen
    // so the avatar is not clipped when dragged to a second monitor.
    this.window.setResizable(true);
    this.window.setBounds({
      x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    });

    if (isMac) this.window.setWindowButtonVisibility(false);
    this.window.setResizable(false);
    this.window.setSkipTaskbar(true);
    this.window.setFocusable(false);
    this.window.setAlwaysOnTop(true, 'screen-saver');

    if (isMac) {
      this.window.setIgnoreMouseEvents(true);
      this.window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    } else {
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  /** Renderer says which pet shell its avatar needs. */
  setPetShell(shell: PetShell): void {
    if (shell !== 'overlay' && shell !== 'compact') return;
    if (shell === this.petShell) return;
    this.petShell = shell;
    if (this.currentMode === 'pet') {
      if (shell === 'compact') this.applyCompactPet(); else this.applyOverlayPet();
    }
  }

  getPetShell(): PetShell {
    return this.petShell;
  }

  /** Renderer measured its compact layout (orb + optional input box). */
  setCompactSize(width: unknown, height: unknown): void {
    this.compactSize = sanitizeSize(width, height, this.compactSize);
    if (!this.isCompactPet() || !this.window || this.drag) return;
    const current = this.window.getBounds();
    if (this.awaitingFirstPlacement) {
      this.awaitingFirstPlacement = false;
      this.applyBounds(clampToWorkAreas(
        defaultPetBounds(screen.getPrimaryDisplay().workArea, this.compactSize),
        this.workAreas(),
      ));
      this.saveCompactBounds();
      return;
    }
    if (current.width === this.compactSize.width && current.height === this.compactSize.height) return;
    this.applyBounds(clampToWorkAreas(
      resizeKeepingTopCenter(current, this.compactSize),
      this.workAreas(),
    ));
    this.saveCompactBounds();
  }

  /** Window drag driven by the renderer's pointer events (screen DIPs). */
  petDrag(phase: unknown, screenX: unknown, screenY: unknown): void {
    if (!this.isCompactPet() || !this.window) return;
    const x = typeof screenX === 'number' && Number.isFinite(screenX) ? screenX : null;
    const y = typeof screenY === 'number' && Number.isFinite(screenY) ? screenY : null;

    if (phase === 'start' && x !== null && y !== null) {
      this.awaitingFirstPlacement = false;
      const [wx, wy] = this.window.getPosition();
      this.drag = { window: { x: wx, y: wy }, pointer: { x, y } };
    } else if (phase === 'move' && this.drag && x !== null && y !== null) {
      const pos = dragTo(this.drag.window, this.drag.pointer, { x, y });
      this.window.setPosition(pos.x, pos.y);
    } else if (phase === 'end' && this.drag) {
      this.drag = null;
      const bounds = clampToWorkAreas(this.window.getBounds(), this.workAreas());
      this.window.setPosition(bounds.x, bounds.y);
      this.compactBounds = this.window.getBounds();
      this.saveCompactBounds();
    }
  }

  /** Displays changed (monitor unplugged, resolution): keep the orb reachable. */
  onDisplaysChanged(): void {
    if (!this.isCompactPet() || !this.window) return;
    const bounds = clampToWorkAreas(this.window.getBounds(), this.workAreas());
    this.window.setPosition(bounds.x, bounds.y);
    this.compactBounds = this.window.getBounds();
    this.saveCompactBounds();
  }

  createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    this.window = new BrowserWindow({
      width: 900,
      height: 670,
      show: false,
      transparent: true,
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      frame: false,
      icon: process.platform === 'win32'
        ? join(__dirname, '../../resources/icon.ico')
        : join(__dirname, '../../resources/icon.png'),
      ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: true,
      },
      hasShadow: false,
      paintWhenInitiallyHidden: true,
      ...options,
    });

    this.setupWindowEvents();
    this.loadContent();

    this.window.on('enter-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', true);
    });

    this.window.on('leave-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', false);
    });

    return this.window;
  }

  private setupWindowEvents(): void {
    if (!this.window) return;

    this.window.on('ready-to-show', () => {
      this.window?.show();
      this.window?.webContents.send(
        'window-maximized-change',
        this.window.isMaximized(),
      );
    });

    this.window.on('maximize', () => {
      this.window?.webContents.send('window-maximized-change', true);
    });

    this.window.on('unmaximize', () => {
      this.window?.webContents.send('window-maximized-change', false);
    });

    this.window.on('resize', () => {
      const window = this.getWindow();
      if (window) {
        const bounds = window.getBounds();
        const { width, height } = screen.getPrimaryDisplay().workArea;
        const isMaximized = bounds.width >= width && bounds.height >= height;
        window.webContents.send('window-maximized-change', isMaximized);
      }
    });

    this.window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });
  }

  private loadContent(): void {
    if (!this.window) return;

    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.window.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  setWindowMode(mode: 'window' | 'pet'): void {
    if (!this.window) return;

    this.currentMode = mode;
    this.window.setOpacity(0);

    if (mode === 'window') {
      this.setWindowModeWindow();
    } else {
      this.setWindowModePet();
    }
  }

  private setWindowModeWindow(): void {
    if (!this.window) return;
    this.drag = null;

    this.window.setAlwaysOnTop(false);
    this.window.setIgnoreMouseEvents(false);
    this.window.setSkipTaskbar(false);
    this.window.setResizable(true);
    this.window.setFocusable(true);
    this.window.setAlwaysOnTop(false);

    this.window.setBackgroundColor('#ffffff');
    this.window.webContents.send('pre-mode-changed', 'window');
  }

  private continueSetWindowModeWindow(): void {
    if (!this.window) return;
    if (this.windowedBounds) {
      this.window.setBounds(this.windowedBounds);
    } else {
      this.window.setSize(900, 670);
      this.window.center();
    }

    if (isMac) {
      this.window.setWindowButtonVisibility(true);
      this.window.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: false,
      });
    }

    this.window?.setIgnoreMouseEvents(false, { forward: true });

    this.window.webContents.send('mode-changed', 'window');
  }

  private setWindowModePet(): void {
    if (!this.window) return;

    this.windowedBounds = this.window.getBounds();

    if (this.window.isFullScreen()) {
      this.window.setFullScreen(false);
    }

    this.window.setBackgroundColor('#00000000');

    this.window.setAlwaysOnTop(true, 'screen-saver');
    if (this.petShell === 'overlay') this.window.setPosition(0, 0);

    this.window.webContents.send('pre-mode-changed', 'pet');
  }

  private continueSetWindowModePet(): void {
    if (!this.window) return;
    if (this.petShell === 'compact') {
      this.applyCompactPet();
    } else {
      this.applyOverlayPet();
    }
    this.window.webContents.send('mode-changed', 'pet');
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.window) return;
    // The compact window is only as big as the orb: it must never go
    // click-through, or it could not be reached again on Linux.
    if (this.isCompactPet()) return;

    if (isMac) {
      this.window.setIgnoreMouseEvents(ignore);
      // this.window.setIgnoreMouseEvents(ignore, { forward: true });
    } else {
      this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }

  maximizeWindow(): void {
    if (!this.window) return;

    if (this.isWindowMaximized()) {
      if (this.windowedBounds) {
        this.window.setBounds(this.windowedBounds);
        this.windowedBounds = null;
        this.window.webContents.send('window-maximized-change', false);
      }
    } else {
      this.windowedBounds = this.window.getBounds();
      const { width, height } = screen.getPrimaryDisplay().workArea;
      this.window.setBounds({
        x: 0, y: 0, width, height,
      });
      this.window.webContents.send('window-maximized-change', true);
    }
  }

  isWindowMaximized(): boolean {
    if (!this.window) return false;
    const bounds = this.window.getBounds();
    const { width, height } = screen.getPrimaryDisplay().workArea;
    return bounds.width >= width && bounds.height >= height;
  }

  updateComponentHover(componentId: string, isHovering: boolean): void {
    if (this.currentMode === 'window') return;
    if (this.isCompactPet()) return;

    // If force ignore is enabled, don't change the mouse ignore state
    if (this.forceIgnoreMouse) return;

    if (isHovering) {
      this.hoveringComponents.add(componentId);
    } else {
      this.hoveringComponents.delete(componentId);
    }

    if (this.window) {
      const shouldIgnore = this.hoveringComponents.size === 0;
      if (isMac) {
        this.window.setIgnoreMouseEvents(shouldIgnore);
      } else {
        this.window.setIgnoreMouseEvents(shouldIgnore, { forward: true });
      }
      if (!shouldIgnore) {
        this.window.setFocusable(true);
      }
    }
  }

  // Toggle force ignore mouse events
  toggleForceIgnoreMouse(): void {
    if (this.isCompactPet()) return;
    this.forceIgnoreMouse = !this.forceIgnoreMouse;

    // Apply the new setting immediately
    if (this.forceIgnoreMouse) {
      if (isMac) {
        this.window?.setIgnoreMouseEvents(true);
      } else {
        this.window?.setIgnoreMouseEvents(true, { forward: true });
      }
    } else {
      // Reapply normal behavior based on hovering components
      const shouldIgnore = this.hoveringComponents.size === 0;
      if (isMac) {
        this.window?.setIgnoreMouseEvents(shouldIgnore);
      } else {
        this.window?.setIgnoreMouseEvents(shouldIgnore, { forward: true });
      }
    }

    // Notify renderer about the change
    this.window?.webContents.send('force-ignore-mouse-changed', this.forceIgnoreMouse);
  }

  // Get current force ignore state
  isForceIgnoreMouse(): boolean {
    return this.forceIgnoreMouse;
  }

  // Get current mode
  getCurrentMode(): 'window' | 'pet' {
    return this.currentMode;
  }
}
