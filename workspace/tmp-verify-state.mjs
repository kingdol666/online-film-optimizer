const http = require('http');

function httpReq(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 8877,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. State
  const state = await httpReq('GET', '/sim/state');
  console.log('=== STATE ===');
  console.log('lineState:', state.lineState);
  console.log('alarmActive:', state.alarmActive);
  console.log('tick:', state.tick);
  console.log('timeSinceLastChangeSec:', state.timeSinceLastChangeSec);
  console.log('heatset_temp:', state.setpoints.heatset_temp);
  console.log('experimentId:', state.experimentId);
  console.log('recipeId:', state.recipeId);
  console.log('lastKnownGoodRecipe:', state.lastKnownGoodRecipe?.id);

  // 2. Online quality
  const quality = await httpReq('GET', '/sim/online-quality');
  console.log('\n=== QUALITY ===');
  console.log(JSON.stringify(quality.metrics, null, 2));

  // 3. Writable parameters
  const writable = await httpReq('GET', '/sim/writable-parameters');
  const heatset = writable.find(p => p.tag === 'heatset_temp');
  console.log('\n=== HEATSET PARAM ===');
  console.log(JSON.stringify(heatset, null, 2));

  // 4. Snapshot
  const snap = await httpReq('GET', '/sim/snapshot');
  console.log('\n=== SNAPSHOT ===');
  console.log('line_state:', snap.line_state);
  console.log('alarm_active:', snap.alarm_active);
  console.log('time_since_last_change_sec:', snap.time_since_last_change_sec);
  console.log('heatset_temp (setpoint):', snap.setpoints?.heatset_temp);
}

main().catch(err => { console.error(err); process.exit(1); });
