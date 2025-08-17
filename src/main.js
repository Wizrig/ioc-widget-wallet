const { app, BrowserWindow } = require('electron');
require('./main-rpc-bridge');
function createWindow(){
  const w = new BrowserWindow({ width: 1200, height: 800 });
  w.loadFile('index.html');
}
app.whenReady().then(createWindow);

// ===== IOC_CONTEXT_EDIT_MENU_V2 (do not remove) =====
(() => {
  const { app, Menu, BrowserWindow } = require('electron');

  function ensureEditMenu() {
    const existing = Menu.getApplicationMenu();
    const hasEdit = existing && existing.items.some(i => i.role === 'editMenu' || i.label === 'Edit');
    if (!hasEdit) {
      const tmpl = [
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        { role: 'editMenu' },
        ...(process.platform !== 'darwin' ? [{ role: 'viewMenu' }, { role: 'windowMenu' }] : [])
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
    }
  }

  function attachContextMenu(contents) {
    contents.on('context-menu', (_e, params) => {
      const { isEditable, selectionText = '', editFlags = {} } = params;
      const items = [];
      if (isEditable) {
        items.push(
          { role: 'undo',  enabled: !!editFlags.canUndo },
          { role: 'redo',  enabled: !!editFlags.canRedo },
          { type: 'separator' },
          { role: 'cut',   enabled: !!editFlags.canCut },
          { role: 'copy',  enabled: !!editFlags.canCopy },
          { role: 'paste', enabled: !!editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: !!editFlags.canSelectAll }
        );
      } else if ((selectionText||'').trim().length > 0) {
        items.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
      } else {
        return;
      }
      const win = BrowserWindow.fromWebContents(contents);
      Menu.buildFromTemplate(items).popup({ window: win });
    });
  }

  function init() {
    ensureEditMenu();
    BrowserWindow.getAllWindows().forEach(w => attachContextMenu(w.webContents));
    app.on('web-contents-created', (_e, contents) => attachContextMenu(contents));
  }

  if (app.isReady()) init();
  else app.whenReady().then(init);
})();
// ===== /IOC_CONTEXT_EDIT_MENU_V2 =====
