// AppImages can't ship the root-owned chrome-sandbox helper, and Ubuntu 23.10+ blocks the
// user namespaces Chromium would fall back to, so the AppImage aborts at startup unless the
// binary gets --no-sandbox. Wrap the executable so a plain double-click works.
// Only runs when AppImage is the sole target: the .deb keeps its setuid sandbox.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPackAppImage(context) {
  if (context.electronPlatformName !== 'linux') return;
  if (!context.targets.length || !context.targets.every((t) => t.name === 'appImage')) return;

  const exe = path.join(context.appOutDir, context.packager.executableName);
  fs.renameSync(exe, `${exe}.bin`);
  fs.writeFileSync(
    exe,
    `#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/${path.basename(exe)}.bin" --no-sandbox "$@"\n`,
    { mode: 0o755 }
  );
};
