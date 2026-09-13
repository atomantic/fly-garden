#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildVisualMapping } from '../server/visual-mapping.js';
const bytes=readFileSync(0);if(bytes.length>4*1024*1024)throw new Error('Metadata input too large');
const source=JSON.parse(bytes),name=source.dataset==='male-cns:v1.0'?'malecns-v1':source.dataset==='banc:v888'?'banc-v888':null;
if(!name)throw new Error('Unknown dataset');
const lock=JSON.parse(readFileSync(new URL(`../connectome/${name==='malecns-v1'?'graph':name+'.graph'}.lock.json`,import.meta.url)));
console.log(JSON.stringify(buildVisualMapping(source,lock.manifestSha256),null,2));
