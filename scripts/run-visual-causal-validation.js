#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {runCausalCampaign} from '../server/visual-causal-campaign.js';
const {values}=parseArgs({options:{run:{type:'boolean',default:false},'male-data':{type:'string'},'banc-data':{type:'string'}}});
if(!values.run||!values['male-data']||!values['banc-data'])throw new Error('Explicit --run --male-data and --banc-data required; this command stimulates temporary research graphs.');
const deadline=setTimeout(()=>{console.error('Causal campaign hard deadline; incomplete, no retries.');process.exit(1);},120000);
try{
 const result=await runCausalCampaign({'male-cns:v1.0':values['male-data'],'banc:v888':values['banc-data']});
 console.log(JSON.stringify({...result,runtime:process.version,platform:process.platform,architecture:process.arch},null,2));if(result.status!=='completed-fixed-campaign')process.exitCode=1;
}finally{clearTimeout(deadline);}
