import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,publicDir:path.join(here,'../public'),plugins:[react()],css:{postcss:{plugins:[{postcssPlugin:'local-fonts',AtRule:{import(rule){if(rule.params.includes('fonts.googleapis.com'))rule.remove();}}}]}},build:{outDir:path.join(here,'../release/portable/web'),emptyOutDir:true}});
