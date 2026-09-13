import { parseArgs } from 'node:util';
import { cpus, totalmem, release } from 'node:os';
import { measureOperatingEnvelope, validateEnvelopeOptions } from '../server/operating-envelope.js';
const{values}=parseArgs({options:{measure:{type:'boolean',default:false},dataset:{type:'string',multiple:true},data:{type:'string',multiple:true},steps:{type:'string',default:'1000'},'batch-steps':{type:'string',default:'100'},'max-memory-mib':{type:'string',default:'2048'},'timeout-seconds':{type:'string',default:'120'}}});
if(!values.measure)throw new Error('Explicit --measure required; this research tool steps temporary zero-drive individuals.');
if(!values.dataset||!values.data||values.dataset.length!==values.data.length)throw new Error('Explicit matching --dataset and --data pairs required');
const entries=values.dataset.map((dataset,i)=>({dataset,directory:values.data[i]}));
const options=validateEnvelopeOptions(entries,{steps:Number(values.steps),batchSteps:Number(values['batch-steps']),maxMemoryMiB:Number(values['max-memory-mib']),timeoutSeconds:Number(values['timeout-seconds'])});
// The standalone process owns all workers. The hard deadline stays armed through cleanup;
// process exit terminates even a worker that never completed its ready/close handshake.
const deadline=setTimeout(()=>{console.error('Operating envelope hard deadline exceeded');process.exit(1);},options.timeoutSeconds*1000);
try{
 const result=await measureOperatingEnvelope(entries,options,{onLimit:()=>{console.error('Operating envelope resource limit exceeded');process.exit(1);}});
 console.log(JSON.stringify({...result,runtime:process.version,platform:process.platform,architecture:process.arch,osRelease:release(),cpuModel:cpus()[0]?.model??'unknown',logicalCpuCount:cpus().length,physicalMemoryBytes:totalmem()},null,2));
}catch(error){console.error(`Operating envelope failed: ${error.message}`);process.exitCode=1;}finally{clearTimeout(deadline);}
