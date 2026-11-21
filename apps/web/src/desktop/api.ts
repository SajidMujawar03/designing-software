/**
 * The desktop app's bridge, exposed by its preload script as `window.desktop`
 * (absent in a normal browser). Kept free of imports: the desktop package
 * uses this file for its side of the contract too.
 */

/** Which kind of window this is: files kept in the app, or a server's files. */
export type DesktopRole = 'offline' | 'cloud';

export interface DesktopSettings {
  /** The server cloud windows open (e.g. https://design.example.com); empty until set. */
  serverUrl: string;
}

/** A .design file on disk. */
export interface DiskFileInfo {
  path: string;
  /** The file name without .design. */
  name: string;
}

export interface RecentFile extends DiskFileInfo {
  /** The folder it's in. */
  folder: string;
  /** Last modified (ms), if the file still exists. */
  modified: number | null;
  missing: boolean;
}

export interface DesktopFiles {
  /** This window's file (null when it shows no file on disk). */
  info(): Promise<DiskFileInfo | null>;
  /** Reads this window's file: the document's state. Rejects with a readable message. */
  read(): Promise<{ state: Uint8Array; docId: string }>;
  /** Saves this window's file (atomically: a crash mid-save leaves the old file). */
  write(state: Uint8Array): Promise<void>;
  /** Unsaved changes, for the title and the close check. */
  setDirty(dirty: boolean): void;
  /** Asks where, saves there, and keeps editing that file. Null if cancelled. */
  saveAs(state: Uint8Array): Promise<DiskFileInfo | null>;
  /** Saves a copy (of a cloud file or a draft) to a new file and opens it. Null if cancelled. */
  saveCopy(state: Uint8Array, suggestedName: string): Promise<DiskFileInfo | null>;
  /** Renames this window's file in its folder. */
  rename(name: string): Promise<DiskFileInfo>;
  showInFolder(): void;
  /** Called before the window closes, to save unsaved changes. */
  onFlushRequest(save: () => Promise<boolean>): void;
}

/** Edit actions the window can do natively in a focused text field. */
export type NativeEditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'delete';

/** An item of a native menu, described by the page. */
export type MenuModelItem =
  | { type: 'command'; id: string; label: string; accelerator?: string; enabled: boolean; /** Settings: shown with a check mark. */ checked?: boolean }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; items: MenuModelItem[] };

/** The menus an editor window adds: items for the File menu, and menus after it. */
export interface MenuModel {
  file: MenuModelItem[];
  menus: Array<{ label: string; items: MenuModelItem[] }>;
}

export interface DesktopBridge {
  readonly platform: 'win32' | 'darwin' | 'linux' | string;
  readonly version: string;
  readonly role: DesktopRole;
  getSettings(): Promise<DesktopSettings>;
  /** Checks and saves the server address, then opens it in a cloud window. Rejects with a message if it's not usable. */
  connectServer(url: string): Promise<void>;
  /** Opens the saved server in a cloud window (or focuses one). */
  openCloud(): Promise<void>;
  /** Opens the start screen in a new window. */
  newWindow(): Promise<void>;

  /** Asks where to save, creates an empty .design file there and opens it. */
  newFile(): Promise<void>;
  /** Asks for a .design file and opens it. */
  openFile(): Promise<void>;
  /** Opens a .design file by path (from the recent list). */
  openPath(path: string): Promise<void>;
  recentFiles(): Promise<RecentFile[]>;
  forgetRecent(path: string): Promise<void>;
  /** Uploads a document to the server as a new cloud file and opens it there. */
  uploadToCloud(state: Uint8Array, name: string): Promise<void>;
  readonly file: DesktopFiles;
  readonly menu: {
    /** This window's menus (an empty model for windows without an editor). */
    set(model: MenuModel): void;
    /** Menu clicks, as command ids from the model. */
    onCommand(run: (id: string) => void): void;
    /** The native text action in the focused text field (undo, copy… while typing). */
    native(action: NativeEditAction): void;
  };
}
