const fs = require('fs');
const path = '/tmp/gitlab_repo/infra/k8s/custom-apps/base/node-red-flow.yaml';
let content = fs.readFileSync(path, 'utf8');

// Find the flows.json block
const marker = '  flows.json: |\n';
const idx = content.indexOf(marker);
if (idx === -1) throw new Error('Could not find flows.json: | block');

const before = content.substring(0, idx + marker.length);
const blockContent = content.substring(idx + marker.length);

// Extract the indented JSON string
const lines = blockContent.split('\n');
let jsonStr = '';
let jsonLines = 0;
for (const line of lines) {
  if (line.trim() === '' || line.startsWith('    ')) {
    jsonStr += line.substring(4) + '\n';
    jsonLines++;
  } else {
    break;
  }
}
const after = blockContent.split('\n').slice(jsonLines).join('\n');

let data = JSON.parse(jsonStr);

// Update login
const loginNode = data.find(n => n.name === 'POST /api/auth/login');
if (loginNode) {
  loginNode.func = loginNode.func.replace(
    'SELECT id,org_id,role,name,email,password_hash FROM users WHERE email=?',
    'SELECT u.id,u.org_id,u.role,u.name,u.email,u.password_hash,o.status FROM users u LEFT JOIN organizations o ON u.org_id=o.id WHERE u.email=?'
  ).replace(
    "delete rl[ip]; global.set('loginRL',rl);",
    "if(u[0].status==='suspended'){msg.headers=__CORS;msg.statusCode=403;msg.payload={error:'organization is suspended'};node.send(msg);return;}\n  delete rl[ip]; global.set('loginRL',rl);"
  );
}

// Update guard
const globalNode = data.find(n => n.func && n.func.includes("global.set('guard',"));
if (globalNode) {
  globalNode.func = globalNode.func.replace(
    "if(policy==='admin' && claims.role!=='admin' && claims.role!=='superadmin') return {ok:false,code:403,error:'admin only'};",
    "if(policy==='admin' && claims.role!=='admin' && claims.role!=='superadmin') return {ok:false,code:403,error:'admin only'};\n  if (claims.role !== 'superadmin' && claims.orgId) {\n    const pool = global.get('pool');\n    const [orgCheck] = await pool.query(\"SELECT status FROM organizations WHERE id=?\", [claims.orgId]);\n    if (!orgCheck.length || orgCheck[0].status === 'suspended') {\n      return {ok:false, code:403, error:'organization is suspended'};\n    }\n  }"
  );
}

// Write back formatted string inside yaml
const newJsonStr = JSON.stringify(data, null, 2);
const indented = newJsonStr.split('\n').map(l => '    ' + l).join('\n') + '\n';

fs.writeFileSync(path, before + indented + after);
console.log('Done');
