const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Submitting ${appPath} to Apple...`);

  await notarize({
    appPath,
    tool: 'notarytool',
    appleApiKey: '/Users/taino/Desktop/AuthKey_64D35XNKWT.p8',
    appleApiKeyId: '64D35XNKWT',
    appleApiIssuer: '69a6de92-e31d-47e3-e053-5b8c7c11a4d1',
  });

  console.log('[notarize] Notarization complete!');
};
