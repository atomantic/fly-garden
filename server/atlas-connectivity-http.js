import { join } from 'node:path';
import { loadAtlas } from './atlas-data.js';
import { loadAtlasConnectivity } from './atlas-connectivity.js';

const PROFILES = Object.freeze({ 'male-cns-v1': { dataset:'male-cns:v1.0', graph:'malecns-v1' }, 'banc-v888': { dataset:'banc:v888', graph:'banc-v888' } });
const send = (response,status,value) => {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify(value));
};
const unavailable = (response,status,reason) => send(response,status,{available:false,reason});
const uint = (value, fallback, max, min = 0) => {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw new Error('Invalid query');
  return Number(value);
};
const checkQuery = (params, allowed) => { const keys=[...params.keys()]; if (new Set(keys).size!==keys.length || keys.some(key=>!allowed.includes(key))) throw new Error('Invalid query'); };

/** Explicit, read-only views. One profile cache; a different profile never loads while a query/load owns it. */
export function createAtlasConnectivityHttp({ atlasDirectory, graphDirectory, loadAtlasData = loadAtlas, loadConnectivity = loadAtlasConnectivity }) {
  let cached = null, loading = null, active = 0;
  async function serviceFor(slug) {
    if (loading) {
      if (loading.slug !== slug) throw Object.assign(new Error('Profile load busy'),{busy:true});
      return loading.promise;
    }
    if (cached?.slug === slug) return cached.service;
    if (active) throw Object.assign(new Error('Profile query busy'),{busy:true});
    // Drop our only strong reference before loading another graph. No per-profile graph map.
    cached = null;
    const profile=PROFILES[slug];
    const promise=(async()=>{
      const atlas=await loadAtlasData(join(atlasDirectory,slug),profile.dataset);
      const service=await loadConnectivity(join(graphDirectory,profile.graph,'graph'),profile.dataset,atlas);
      cached={slug,service};return service;
    })();
    loading={slug,promise};
    try { return await promise; } finally { loading=null; }
  }
  return async (request,response,url) => {
    const match=/^\/api\/atlas\/([a-z0-9-]+)\/(connectivity|adjacency)$/.exec(url.pathname);
    if (!match) return false;
    const [,slug,operation]=match;
    if (!Object.hasOwn(PROFILES,slug)) { unavailable(response,404,'Unknown anatomical connectivity profile.'); return true; }
    if (request.method!=='GET') { unavailable(response,405,'Anatomical connectivity is read-only.'); return true; }
    let query;
    try {
      if (operation==='connectivity') {
        checkQuery(url.searchParams,['limit']);
        query={density:1,maxEdges:uint(url.searchParams.get('limit'),2000,20000)};
      } else {
        checkQuery(url.searchParams,['neuron','offset','limit','direction']);
        const neuron=url.searchParams.get('neuron'),direction=url.searchParams.get('direction')??'both';
        if (typeof neuron!=='string' || neuron.length>128 || !neuron.startsWith(`${PROFILES[slug].dataset}/`)
          || !/^[1-9]\d{0,18}$/.test(neuron.slice(PROFILES[slug].dataset.length+1)) || !['both','incoming','outgoing'].includes(direction)) throw new Error('Invalid query');
        query={neuron,direction,offset:uint(url.searchParams.get('offset'),0,0xffffffff),limit:uint(url.searchParams.get('limit'),100,1000,1)};
      }
    } catch { unavailable(response,400,'Invalid or duplicate anatomical connectivity query parameters.'); return true; }
    const controller=new AbortController();
    const abort=()=>controller.abort();
    const close=()=>{if(!response.writableEnded) abort();};
    request.once('aborted',abort);response.once('close',close);
    let ownsQuery=false;
    try {
      const service=await serviceFor(slug);
      if(controller.signal.aborted) return true;
      active++;ownsQuery=true;
      const result=operation==='connectivity' ? service.sample(query) : await service.adjacency(query.neuron,{direction:query.direction,offset:query.offset,limit:query.limit,signal:controller.signal});
      if(!controller.signal.aborted) send(response,200,{available:true,...result});
    } catch (error) {
      if(!controller.signal.aborted) {
        if(error.busy || cached?.service.status().scanning) unavailable(response,409,'Another anatomical connectivity load or query is in progress. Retry after it completes.');
        else unavailable(response,503,'Exact pinned connectivity is missing, incompatible, unreadable, or the requested adjacency is unavailable. No synthetic edges substituted.');
      }
    } finally {
      if(ownsQuery) active--;
      request.off('aborted',abort);response.off('close',close);
    }
    return true;
  };
}
