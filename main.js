import { app, BrowserWindow } from 'electron';

import path from 'path';

function createWindow() {
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 1450,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "LogiSim - Punto Fijo Edition",
    backgroundColor: '#0a0a0a',
  });

  mainWindow.loadFile('index.html');
  
  // Opcional: abrir herramientas de desarrollo
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
