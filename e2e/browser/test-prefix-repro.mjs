import mysql from '/home/user/carbon-credit-platform/backend/node_modules/mysql2/promise.js';
const ENV = { DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'admin', DB_PASSWORD: 'iothub.2026', DB_NAME: 'iothub' };
const env = { get: (k) => ENV[k] };
const controlPool = mysql.createPool({ host: ENV.DB_HOST, port: +ENV.DB_PORT, user: ENV.DB_USER, password: ENV.DB_PASSWORD, database: ENV.DB_NAME, namedPlaceholders: true });
const __TENANT = true;
const __DBTZ = '+07:00';
// orgDbName, unmodified
function orgDbName(orgId){
  const slug=String(orgId||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return slug ? ('iothub_'+slug).slice(0,64) : '';
}
// resolvePool AS IT WAS BEFORE THE FIX (no __unassigned__ special case)
function resolvePoolOld(orgId){
  const ctl=controlPool;
  if(!__TENANT || !orgId) return ctl;
  if(orgId === 'org-1' || orgId === 'org-2' || orgId === 'org-3') return ctl;
  const dbn=orgDbName(orgId); if(!dbn) return ctl;
  const p=mysql.createPool({ host: ENV.DB_HOST, port:+ENV.DB_PORT, user: ENV.DB_USER, password: ENV.DB_PASSWORD, database: dbn, namedPlaceholders:true });
  return p;
}
console.log('dbn for __unassigned__:', orgDbName('__unassigned__'), '(this DB was never created)');
const bad = resolvePoolOld('__unassigned__');
try {
  await bad.query('SELECT id FROM node_photos WHERE node_id=?', ['tr-1001']);
  console.log('unexpectedly succeeded');
} catch (e) {
  console.log('REPRODUCED the original 500: ', e.code, '-', e.message);
}
await controlPool.end();
await bad.end();
