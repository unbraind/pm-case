import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

const root=await mkdtemp(join(tmpdir(),'case-reverts-'));const proofs=[];
try{
  await cp('dist',join(root,'dist'),{recursive:true});await cp('test',join(root,'test'),{recursive:true});await cp('scripts',join(root,'scripts'),{recursive:true});await writeFile(join(root,'package.json'),'{"type":"module"}');await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  const mutations=[
    {file:'kernel.js',before:'return Object.entries(partial).every(([key, value]) => Object.hasOwn(full, key) && full[key] === value);',after:'return false;',test:'core.test.ts',pattern:'^independent brute-force oracle'},
    {file:'kernel.js',before:'new Set(recorded.map(row => row.result.identity)).size === recorded.length && ',after:'',test:'core.test.ts',pattern:'^native read-back refuses duplicate receipt bindings'},
    {file:'api.js',before:'insist(found.request_digest === digest(request),',after:'insist(true,',test:'core.test.ts',pattern:'^real SDK owner retains'},
    {file:'api.js',before:'itemHash: owner.revision',after:'itemHash: (await host.client.readItemRevision(owner.id)).item_hash',test:'concurrency.test.ts',pattern:'^competing write at before_update'},
    {file:'api.js',before:"fitEnvelope(host, envelope(committed(id, 'f'.repeat(64), operation, false)), budget);",after:'void budget;',test:'contracts.test.ts',pattern:'^all write budgets refuse'},
  ];
  for(const mutation of mutations){const path=join(root,'dist/src',mutation.file);const original=await readFile(path,'utf8');assert.equal(original.split(mutation.before).length,2,'Revert seam must identify exactly one behavior');
    const args=['--test','--test-concurrency=1','--test-name-pattern',mutation.pattern,`test/${mutation.test}`];const options={cwd:root,env:testEnvironment(npmEnvironment(process.env)),encoding:'utf8' as const,timeout:90000,maxBuffer:4*1024*1024};
    try{await writeFile(path,original.replace(mutation.before,mutation.after));const red=spawnSync(process.execPath,args,options);assert.equal(red.status,1);assert.match(red.stdout+red.stderr,/AssertionError/);assert.doesNotMatch(red.stdout+red.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);}
    finally{await writeFile(path,original);}
    const green=spawnSync(process.execPath,args,options);assert.equal(green.status,0,green.stdout+green.stderr);proofs.push({function_behavior:mutation.before,test:mutation.test,pattern:mutation.pattern,reverted_exit:1,restored_exit:0});
  }
  await writeFile('revert-receipt.local.json',JSON.stringify({proofs,workspace_mutated:false},null,2)+'\n');console.log(JSON.stringify({behavioral_reverts:proofs.length,red:proofs.length,restored_green:proofs.length}));
}finally{await rm(root,{recursive:true,force:true});}
