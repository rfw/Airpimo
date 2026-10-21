#!/usr/bin/env node
/** Fetch an exact, SHA-256-locked GitHub Release asset. No guessed URLs/versions. */
import {existsSync, readFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256} from './native-bundle-core.mjs';

export function checkedReleaseAssetInputs({repo,tag,name,sha,output}) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??''))throw Error('Missing or invalid GitHub repository');
  if(!/^[\w.-]+$/.test(tag??''))throw Error('Set repository variable UXPLAY_NATIVE_RELEASE_TAG to an existing audited GitHub Release tag');
  if(!/^[\w.+-]+\.(tar\.gz|zip)$/.test(name??''))throw Error('Unsafe or missing release asset filename');
  if(!/^[0-9a-f]{64}$/i.test(sha??''))throw Error(`Set reviewed SHA-256 for ${name} in repository Actions variables`);
  if(!output)throw Error('Missing asset output path');
  return {repo,tag,name,sha:sha.toLowerCase(),output:resolve(output)};
}
export function checkAssetSha(file,sha) {
  if(!existsSync(file))throw Error(`Reviewed asset missing: ${file}`);
  if(sha256(readFileSync(file))!==sha.toLowerCase())throw Error(`Reviewed asset SHA-256 mismatch: ${file}`);
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.dirname,'ci-reviewed-asset.mjs')) {
  const v=process.argv.slice(2), flags=Object.fromEntries(v.filter((x,i)=>x.startsWith('--')).map(x=>[x.slice(2),v[v.indexOf(x)+1]]));
  try {
    const a=checkedReleaseAssetInputs({repo:flags.repo,tag:flags.tag,name:flags.name,sha:flags.sha256,output:flags.out});
    mkdirSync(dirname(a.output),{recursive:true});
    if(a.output !== resolve(dirname(a.output),a.name))throw Error('Output filename must match exact reviewed asset name');
    const dl=spawnSync('gh',['release','download',a.tag,'--repo',a.repo,'--pattern',a.name,'--dir',dirname(a.output),'--clobber'],{stdio:'inherit',windowsHide:true});
    if(dl.error||dl.status!==0)throw Error(`GitHub Release asset download failed: ${dl.error?.message??dl.status}`);
    checkAssetSha(a.output,a.sha);
    console.log(`PASS: reviewed ${a.name} downloaded and SHA-256 verified`);
  } catch(err){console.error(`[ci-asset] BLOCKED: ${err.message}`);process.exitCode=2;}
}
