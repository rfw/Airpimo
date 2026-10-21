/** Separate GStreamer plugin loading from GCC/CMake host-tool DLL resolution.
 * Both sets of tools live on Windows but their libstdc++/pthread ABI may differ.
 */
import {join} from 'node:path';

export function win7MdnsEnvironments({gst,mingw,usr,msys,inheritedEnv=process.env}) {
  const gstBin=join(gst,'bin');
  // Windows environment names are case-insensitive; avoid two competing PATH keys.
  const cleanEnv=Object.fromEntries(Object.entries(inheritedEnv).filter(([key])=>key.toUpperCase()!=='PATH'));
  const base={
    ...cleanEnv,
    MSYSTEM:'MINGW64',
    MSYSTEM_PREFIX:'/mingw64',
    PKG_CONFIG_PATH:[join(gst,'lib','pkgconfig'),join(gst,'share','pkgconfig'),join(msys,'mingw64','lib','pkgconfig')].join(';'),
  };
  const existing=inheritedEnv.PATH||inheritedEnv.Path||'';
  // GCC's cc1, assembler, linker, CMake and Ninja must see matching MSYS2 DLLs.
  const toolEnv={...base,PATH:[mingw,usr,gstBin,existing].join(';')};
  // GStreamer 1.24 inspector/plugins must see their own DLL versions.
  const gstEnv={...base,PATH:[gstBin,mingw,usr,existing].join(';')};
  return {toolEnv,gstEnv};
}
