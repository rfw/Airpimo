import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncProjectVersion} from '../scripts/ci/sync-release-version.mjs';

function fixture(callback,{packageVersion='0.1.5',lockVersion='0.1.5',cargoPackage='airpimo',tauriVersion='0.1.4'}={}){
  const root=mkdtempSync(join(tmpdir(),'uxplay-version-sync-'));
  const tauri=join(root,'src-tauri');mkdirSync(tauri);
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'airpimo',version:packageVersion}));
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({name:'airpimo',version:lockVersion,packages:{'':{version:lockVersion}}}));
  writeFileSync(join(tauri,'tauri.conf.json'),`{\n  "version": "${tauriVersion}",\n  "bundle": {"targets": ["nsis"]}\n}\n`);
  writeFileSync(join(tauri,'Cargo.toml'),`[package]\nname = "${cargoPackage}"\nversion = "0.1.4"\nedition = "2021"\n\n[dependencies]\nserde = "1.0.219"\n`);
  writeFileSync(join(tauri,'Cargo.lock'),`version = 3\n\n[[package]]\nname = "serde"\nversion = "1.0.219"\n\n[[package]]\nname = "airpimo"\nversion = "0.1.4"\ndependencies = [\n "serde",\n]\n`);
  try{return callback(root);}finally{rmSync(root,{recursive:true,force:true});}
}
test('version synchronization updates only three project metadata files, preserving dependency versions',()=>fixture(root=>{
  const before=syncProjectVersion(root);
  assert.equal(before.applied,false);
  assert.equal(before.files.length,3);
  const cargo=join(root,'src-tauri','Cargo.toml');
  assert.match(readFileSync(cargo,'utf8'),/version = "0\.1\.4"/);
  const result=syncProjectVersion(root,{apply:true});
  assert.equal(result.version,'0.1.5');
  assert.equal(result.files.length,3);
  assert.equal(syncProjectVersion(root).files.length,0);
  assert.equal(JSON.parse(readFileSync(join(root,'src-tauri','tauri.conf.json'))).version,'0.1.5');
  assert.match(readFileSync(cargo,'utf8'),/version = "0\.1\.5"/);
  assert.match(readFileSync(cargo,'utf8'),/serde = "1\.0\.219"/);
  const lock=readFileSync(join(root,'src-tauri','Cargo.lock'),'utf8');
  assert.match(lock,/name = "airpimo"\nversion = "0\.1\.5"/);
  assert.match(lock,/name = "serde"\nversion = "1\.0\.219"/);
}));

test('version sync fails without modifying Tauri or Cargo when npm lock is inconsistent',()=>fixture(root=>{
  const tauri=join(root,'src-tauri','tauri.conf.json'), original=readFileSync(tauri,'utf8');
  assert.throws(()=>syncProjectVersion(root,{apply:true}),/package-lock.json differs/);
  assert.equal(readFileSync(tauri,'utf8'),original);
},{lockVersion:'0.1.4'}));

test('version sync fails without partial changes for wrong Cargo package',()=>fixture(root=>{
  const tauri=join(root,'src-tauri','tauri.conf.json'), original=readFileSync(tauri,'utf8');
  assert.throws(()=>syncProjectVersion(root,{apply:true}),/Cargo.toml package table missing/);
  assert.equal(readFileSync(tauri,'utf8'),original);
},{cargoPackage:'different'}));

test('version sync keeps Tauri package.json reference while updating Cargo metadata',()=>fixture(root=>{
  const tauri=join(root,'src-tauri','tauri.conf.json');
  const original=readFileSync(tauri,'utf8');
  const plan=syncProjectVersion(root);
  assert.equal(plan.files.length,2);
  const result=syncProjectVersion(root,{apply:true});
  assert.equal(result.files.length,2);
  assert.equal(readFileSync(tauri,'utf8'),original);
  assert.equal(JSON.parse(readFileSync(tauri,'utf8')).version,'../package.json');
  assert.equal(syncProjectVersion(root).files.length,0);
  assert.match(readFileSync(join(root,'src-tauri','Cargo.toml'),'utf8'),/version = "0\.1\.5"/);
  assert.match(readFileSync(join(root,'src-tauri','Cargo.lock'),'utf8'),/name = "airpimo"\nversion = "0\.1\.5"/);
},{tauriVersion:'../package.json'}));

test('version sync fails closed on an unexpected Tauri reference',()=>fixture(root=>{
  const cargo=join(root,'src-tauri','Cargo.toml');
  const initial=readFileSync(cargo,'utf8');
  assert.throws(()=>syncProjectVersion(root,{apply:true}),/unsupported Tauri version reference/);
  assert.equal(readFileSync(cargo,'utf8'),initial);
},{tauriVersion:'../elsewhere.json'}));
