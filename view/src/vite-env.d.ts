/// <reference types="vite/client" />

interface FileSystemDirectoryHandle {
  name: string;
}

interface Window {
  __TAURI_INTERNALS__?: unknown;
  /** File System Access API（Chrome/Edge），仅用于网页端本地目录选择。 */
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}
