import { RuntimeError } from './runtime.js';
export function createConnectomeRecordingHttp({service,readBody,json,checkOrigin}) {
 return async(request,response,url,base)=>{
  if(url.pathname!=='/api/connectome-recordings'&&!url.pathname.startsWith('/api/connectome-recordings/'))return false;
  if(url.search)throw new RuntimeError('Recording endpoints do not accept query parameters.');
  const match=/^\/api\/connectome-recordings\/([a-f0-9-]{36})(?:\/(capture|stop|delete|export|replay))?$/.exec(url.pathname);
  if(url.pathname!=='/api/connectome-recordings'&&!match)throw new RuntimeError('Recording route not found.',404);
  const id=match?.[1],action=match?.[2];
  try{
   if(request.method==='GET'&&(!id||!action||['export','replay'].includes(action))){json(response,200,!id?service.view():action==='replay'?service.replay(id):service.read(id));return true;}
   if(request.method!=='POST'||id&&!['capture','stop','delete'].includes(action))throw new RuntimeError('Method not allowed.',405);
   checkOrigin(request,base);const body=await readBody(request,id?4096:36*1024);
   if(id&&Object.keys(body).length)throw new RuntimeError('Expected an empty object.');
   json(response,200,id?await service[action](id):await service.start(body));return true;
  }catch(e){if(e instanceof RuntimeError)throw e;throw new RuntimeError('Connectome recording operation failed. Stored history and neural state remain separate.',409);}
 };
}
