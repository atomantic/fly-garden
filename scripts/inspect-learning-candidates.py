#!/usr/bin/env python3
"""Read pinned annotation metadata only. No weights, model, stimulation or training."""
import argparse, collections, hashlib, json
from pathlib import Path
import pyarrow.feather as feather
parser=argparse.ArgumentParser();parser.add_argument('--male-annotations',required=True);parser.add_argument('--banc-annotations',required=True)
args=parser.parse_args();repo=Path(__file__).resolve().parent.parent
result={'schemaVersion':1,'kind':'annotation-candidate-inventory','executionPerformed':False,'profiles':[]}
for dataset,path,lock in [('male-cns:v1.0',args.male_annotations,'malecns-v1.lock.json'),('banc:v888',args.banc_annotations,'banc-v888.lock.json')]:
 source=json.loads((repo/'connectome'/lock).read_text())['files']['annotations'];h=hashlib.sha256()
 with open(path,'rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 if h.hexdigest()!=source['sha256'] or Path(path).stat().st_size!=source['bytes']:raise ValueError('Pinned annotation mismatch')
 male=dataset.startswith('male');columns=['bodyId','status','class','superclass','type','somaSide','assignedOlHex1','assignedOlHex2'] if male else ['banc_888_id','root_888','proofread','roughly_proofread','cell_class','cell_sub_class','super_class','cell_type','side']
 table=feather.read_table(path,columns=columns,memory_map=True)
 rows=[r for r in table.to_pylist() if (r['status']=='Traced' if male else (r['proofread']=='TRUE' or r['roughly_proofread']=='TRUE') and r['super_class'] not in ['glia','trachea','not_a_neuron'])]
 identity='bodyId' if male else 'banc_888_id';typ='type' if male else 'cell_type';cls='class' if male else 'cell_class';side='somaSide' if male else 'side'
 if not male and any(r['banc_888_id']!=r['root_888'] for r in rows):raise ValueError('Wrong materialization identity')
 rules={
  'kenyon_class':lambda r:r[cls]==('Kenyon_Cell' if male else 'kenyon_cell'),
  'mbon_class':lambda r:r[cls]==('MBON' if male else 'mushroom_body_output_neuron'),
  'pam_type_prefix':lambda r:str(r[typ] or '').startswith('PAM'),
  'visual_receptor_class':lambda r:r[cls]==('visual' if male else 'photoreceptor_neuron'),
  'descending_class':lambda r:r['superclass' if male else cls]==('descending_neuron'),
  'motor_class':lambda r:r['superclass'] in ['cb_motor','vnc_motor'] if male else r['super_class']=='motor',
 }
 groups={}
 for name,predicate in rules.items():
  selected=[r for r in rows if predicate(r)];ordered=sorted(selected,key=lambda r:int(r[identity]))
  groups[name]={'count':len(selected),'examples':[{'neuronId':dataset+'/'+str(r[identity]),'sourceType':r[typ]} for r in ordered[:3]],
   'sideCounts':dict(sorted(collections.Counter(str(r[side]) if r[side] is not None else 'unknown' for r in selected).items()))}
 vision=[r for r in rows if rules['visual_receptor_class'](r)]
 record={'dataset':dataset,'sourceSha256':source['sha256'],'sourceBytes':source['bytes'],'sourceRows':table.num_rows,'retainedRows':len(rows),
  'selection':'status == Traced' if male else '(proofread == TRUE or roughly_proofread == TRUE) and super_class not glia/trachea/not_a_neuron',
  'sourceColumns':columns,'groups':groups,'visualTypes':dict(sorted(collections.Counter(str(r[typ]) if r[typ] is not None else 'unknown' for r in vision).items())),
  'visualRetinotopy':{'completeHexPairs':sum(r['assignedOlHex1'] is not None and r['assignedOlHex2'] is not None for r in vision)} if male else {'completeHexPairs':None,'reason':'No equivalent retinotopy columns in this source schema.'}}
 if not male:record['pamSubclassCount']=sum(r['cell_sub_class']=='PAM_dopaminergic_neuron' for r in rows)
 result['profiles'].append(record)
print(json.dumps(result,indent=2,sort_keys=True))
