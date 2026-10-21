/** Verify a Windows GStreamer SDK version without launching an executable.
 * A raw SDK gst-inspect may hang when the runtime and MSYS2 CRTs are mixed;
 * inspect the paired, installed *development* metadata first. The staged
 * runtime still has to pass ABI and real plugin-load smoke before promotion.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function readWin7GstSdkVersion(gstRoot,{read=readFileSync}={}) {
  const pc=join(gstRoot,'lib','pkgconfig','gstreamer-1.0.pc');
  const header=join(gstRoot,'include','gstreamer-1.0','gst','gstversion.h');
  let pcText,headerText;
  try {pcText=read(pc,'utf8');}
  catch(e) {throw Error(`Cannot read GStreamer SDK development version: ${pc} (${e.code||e.message}). Install the matching 1.24 runtime + devel MSI.`);}
  try {headerText=read(header,'utf8');}
  catch(e) {throw Error(`Cannot read GStreamer SDK version header: ${header} (${e.code||e.message}). Install the matching 1.24 runtime + devel MSI.`);}
  const version=pcText.match(/^Version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  if(!version)throw Error(`Invalid GStreamer version in ${pc}; expected a Version: major.minor.micro field`);
  function macro(name) {
    const pattern=new RegExp(`^\\s*#\\s*define\\s+GST_VERSION_${name}\\s+\\(?\\s*(\\d+)\\b`,'m');
    const match=headerText.match(pattern);
    if(!match)throw Error(`Missing GST_VERSION_${name} in ${header}`);
    return Number(match[1]);
  }
  const headerVersion=[macro('MAJOR'),macro('MINOR'),macro('MICRO')].join('.');
  if(headerVersion!==version) throw Error(`GStreamer SDK version mismatch: pkg-config=${version}; header=${headerVersion}. Do not mix runtime/development MSI versions.`);
  if(!/^1\.24\.\d+$/.test(version))throw Error(`Win7 requires audited GStreamer 1.24.x; found ${version}`);
  return version;
}
