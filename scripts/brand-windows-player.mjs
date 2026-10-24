#!/usr/bin/env node
/** Rename only the verified staged Windows engine for product-facing identity.
 * Audited UxPlay binary bytes stay unchanged; cache and upstream names remain uxplay.exe.
 * Safe to run repeatedly before both Windows NSIS build entry points.
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, renameSync, writeFileSync, statSync, unlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SOURCE = 'uxplay.exe';
export const BRANDED = 'AirpimoPlayer.exe';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function brandWindowsPlayer(resources) {
  const root=resolve(resources), sidecar=join(root,'sidecar');
  const manifestFile=join(root,'native-manifest.json');
  if(!existsSync(manifestFile))throw Error('Native manifest missing before Windows player branding');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  if(manifest.os!=='win32'||manifest.arch!=='x64'||manifest.ready!==true)throw Error('Only verified staged Windows x64 native resources may be branded');
  const source=join(sidecar,SOURCE), target=join(sidecar,BRANDED);
  const oldPath=`sidecar/${SOURCE}`, newPath=`sidecar/${BRANDED}`;
  const oldEntry=manifest.files?.find(f=>f.path===oldPath);
  const newEntry=manifest.files?.find(f=>f.path===newPath);
  if((oldEntry&&newEntry)||(!oldEntry&&!newEntry))throw Error('Expected exactly one declared receiver executable');
  const entry=oldEntry??newEntry;
  if(!/^[a-f0-9]{64}$/.test(entry.sha256??''))throw Error('Native receiver SHA-256 missing');
  // Another receiver binary is never silently accepted or deleted.
  if(existsSync(source)&&existsSync(target))throw Error('Both legacy and branded receiver binaries exist; refusing ambiguous stage');
  if(existsSync(source) && (!statSync(source).isFile()||hash(source)!==entry.sha256))throw Error('Legacy receiver SHA-256 mismatch');
  if(existsSync(target) && (!statSync(target).isFile()||hash(target)!==entry.sha256))throw Error('Branded receiver SHA-256 mismatch');
  if(oldEntry) {
    // Recover from interruption after rename but before writing the manifest.
    if(!existsSync(target)) {
      if(!existsSync(source))throw Error('Staged receiver missing');
      renameSync(source,target);
    }
    entry.path=newPath;
    const temporary=`${manifestFile}.branding-${process.pid}.tmp`;
    try {
      writeFileSync(temporary,JSON.stringify(manifest,null,2)+'\n');
      renameSync(temporary,manifestFile);
    } finally {try {if(existsSync(temporary)) unlinkSync(temporary);} catch {}}
  } else if(!existsSync(target))throw Error('Branded receiver missing');
  return {path:target,sha256:entry.sha256,changed:Boolean(oldEntry)};
}
const entry=fileURLToPath(import.meta.url);
if(process.argv[1] && resolve(process.argv[1])===entry) {
  if(process.platform!=='win32') {
    if(process.argv.includes('--if-windows'))process.exit(0);
    console.error('BLOCKED: Windows-only player branding');process.exit(2);
  }
  const root=resolve(import.meta.dirname,'../src-tauri/resources');
  try {const result=brandWindowsPlayer(root);console.log(`[Airpimo] Windows receiver: ${BRANDED} (${result.changed?'branded':'already branded'})`);}
  catch(error) {console.error(`BLOCKED Windows player branding: ${error.message}`);process.exit(2);}
}
