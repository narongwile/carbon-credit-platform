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

// Update DELETE orgs
const delNode = data.find(n => n.name === 'DELETE /api/orgs/:id');
if (delNode) {
  delNode.func = delNode.func.replace(
    'await pool.query("DELETE FROM organizations WHERE id=?",[id]);',
    'await pool.query("DELETE FROM organizations WHERE id=?",[id]); await pool.query("DELETE FROM users WHERE org_id=?",[id]); await pool.query("DELETE FROM org_directory WHERE org_id=?",[id]); await pool.query("DELETE FROM org_entitlements WHERE org_id=?",[id]); if(global.get(\'tenantMode\')){ const dbn = global.get(\'orgDbName\')(id); if(dbn) await pool.query(`DROP DATABASE IF EXISTS \\`${dbn}\\``); }'
  );
}

// Write back formatted string inside yaml
const newJsonStr = JSON.stringify(data, null, 2);
const indented = newJsonStr.split('\n').map(l => '    ' + l).join('\n') + '\n';

fs.writeFileSync(path, before + indented + after);
console.log('Done');
