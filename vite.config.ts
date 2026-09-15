import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const r=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
export default defineConfig({root:r('.'),plugins:[react()],resolve:{alias:{'@mixednuts/engine':r('../../packages/engine/src/index.ts'),'@mixednuts/protocol':r('../../packages/protocol/src/index.ts')}},server:{port:5173}});
