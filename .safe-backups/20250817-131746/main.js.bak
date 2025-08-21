const { app, BrowserWindow } = require('electron');
require('./main-rpc-bridge');
function createWindow(){
  const w = new BrowserWindow({ width: 1200, height: 800 });
  w.loadFile('index.html');
}
app.whenReady().then(createWindow);
