import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { initDatabase } from './main/database';
import { registerIpcHandlers } from './main/ipc-handlers';
import { startScheduler } from './main/scheduler';

if (started) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development with our custom workflow, MAIN_WINDOW_VITE_DEV_SERVER_URL won't be set
  // because we disabled the renderer in forge config during dev
  // In production build, electron-forge will set MAIN_WINDOW_VITE_DEV_SERVER_URL and MAIN_WINDOW_VITE_NAME

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Development mode via electron-forge (production build will not have this)
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    // Development with our manual Vite server
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Production: load from packaged files
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on('ready', () => {
  initDatabase();
  registerIpcHandlers();
  startScheduler();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
