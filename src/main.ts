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
    resizable: true,
    movable: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development: load from our manually-started Vite server (via concurrently)
  // In production: load from bundled files built by prePackage hook
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // __dirname in packaged app is: .vite/build/
    // We need to reach: .vite/renderer/main_window/index.html
    const indexPath = path.join(__dirname, '../renderer/main_window/index.html');
    mainWindow.loadFile(indexPath);
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
