import { RuntimeError } from './runtime.js';
export function createConnectomeHttp({service,readBody,json,checkOrigin}) {
  return async function handle(request,response,url,base) {
    if(url.pathname!=='/api/connectomes'&&!url.pathname.startsWith('/api/connectomes/'))return false;
    if(url.search)throw new RuntimeError('Research endpoints do not accept query parameters.');
    const match=/^\/api\/connectomes\/([0-9a-f-]+)(?:\/(commands|history|samples))?$/.exec(url.pathname);
    if(url.pathname!=='/api/connectomes'&&!match)throw new RuntimeError('Research API route not found.',404);
    const id=match?.[1],operation=match?.[2];
    if(request.method==='GET') {
      if(operation==='commands'||operation==='samples')throw new RuntimeError('Use POST for research commands.',405);
      json(response,200,id?(operation==='history'?service.history(id):service.snapshot(id)):service.view());return true;
    }
    if(request.method!=='POST'||id&&!['commands','samples'].includes(operation))throw new RuntimeError('Method not allowed.',405);
    checkOrigin(request,base);const body=await readBody(request,operation==='samples'?36*1024:4096);
    json(response,200,id?(operation==='samples'?await service.sample(id,body):await service.command(id,body)):await service.create(body));return true;
  };
}
