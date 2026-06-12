import http from 'node:http';
import { IndustrialFilmLineSimulator } from './line-simulator.mjs';
import { listProductProfiles } from './product-catalog.mjs';

const simulator = new IndustrialFilmLineSimulator();
const port = Number(process.env.SIM_PORT || 8877);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/sim/products') return send(res, 200, listProductProfiles());
    if (req.method === 'POST' && url.pathname === '/sim/reset') return send(res, 200, simulator.reset(await readBody(req)));
    if (req.method === 'GET' && url.pathname === '/sim/state') return send(res, 200, simulator.getState());
    if (req.method === 'GET' && url.pathname === '/sim/writable-parameters') return send(res, 200, simulator.getWritableParameters());
    if (req.method === 'GET' && url.pathname === '/sim/snapshot') return send(res, 200, simulator.getSnapshot());
    if (req.method === 'GET' && url.pathname === '/sim/online-quality') return send(res, 200, simulator.getOnlineQuality());
    if (req.method === 'POST' && url.pathname === '/sim/proposal/preview') return send(res, 200, simulator.preview(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/sim/setpoints/preview') return send(res, 200, simulator.previewSetpoints(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/sim/apply') return send(res, 200, simulator.apply(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/sim/setpoints/apply') return send(res, 200, simulator.applySetpoints(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/sim/tick') return send(res, 200, simulator.tickForward((await readBody(req)).count || 1));
    if (req.method === 'POST' && url.pathname === '/sim/run-until-stable') return send(res, 200, simulator.runUntilStable(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/sim/rollback') return send(res, 200, simulator.rollback((await readBody(req)).reason));
    if (req.method === 'POST' && url.pathname === '/sim/recipe/save-candidate') return send(res, 200, simulator.saveCandidateRecipe(await readBody(req)));
    if (req.method === 'GET' && url.pathname === '/sim/ledger') return send(res, 200, simulator.getLedger());
    send(res, 404, { error: 'not_found', path: url.pathname });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`industrial-film-line simulator listening on http://localhost:${port}`);
});
