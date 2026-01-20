const fs = require('node:fs');
const axios = require('axios');
const { CONF_PATH } = require('../shared/constants');
function readCreds() {
  const txt = fs.readFileSync(CONF_PATH, 'utf8');
  const u = /rpcuser=(.+)/.exec(txt)?.[1] ?? '';
  const p = /rpcpassword=(.+)/.exec(txt)?.[1] ?? '';
  return { u, p };
}
async function rpc(method, params=[]) {
  const startTime = Date.now();
  console.log(`[RPC] ${method} starting`);
  try {
  const { u, p } = readCreds();
  const { data } = await axios.post('http://127.0.0.1:33765/', { jsonrpc:'2.0', id:1, method, params }, { auth:{ username:u, password:p }, timeout:20000 });
  const elapsed = Date.now() - startTime;
  if (elapsed > 5000) {
    console.warn(`[RPC] ${method} SLOW: ${elapsed}ms`);
  } else {
    console.log(`[RPC] ${method} completed in ${elapsed}ms`);
  }
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[RPC] ${method} failed after ${elapsed}ms:`, err && err.message ? err.message : err);
    throw err;
  }

}
const getBlockCount      = () => rpc('getblockcount');
const getConnectionCount = () => rpc('getconnectioncount');
const getWalletInfo      = () => rpc('getwalletinfo');
const getMiningInfo      = () => rpc('getmininginfo').catch(()=>({}));
const getStakingInfo     = () => rpc('getstakinginfo').catch(()=>({}));
const getPeerInfo        = () => rpc('getpeerinfo').catch(()=>([]));
const getNewAddress      = (label='ioc-widget') => rpc('getnewaddress', [label]);
const sendToAddress      = (addr, amt, c='', ct='') => rpc('sendtoaddress', [addr, amt, c, ct]);
const walletLock         = () => rpc('walletlock');
const walletPassphrase   = (pass, secs) => rpc('walletpassphrase', [pass, secs]);
const listTransactions   = (count=50) => rpc('listtransactions', ["*", count, 0, true]);
const getInfo            = () => rpc('getinfo').catch(()=>({}));
const getEncStatus       = () => rpc('getencryptionstatus').catch(()=>null);
const getLockStatus      = () => rpc('walletlockstatus').catch(()=>null);
const reserveBalance     = (reserve, amount=999999999) => reserve ? rpc('reservebalance', [true, amount]) : rpc('reservebalance', [false]);
module.exports = { rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo, getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions, getInfo, getEncStatus, getLockStatus, reserveBalance };
