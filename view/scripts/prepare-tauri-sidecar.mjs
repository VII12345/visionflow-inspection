import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const viewRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceDir = path.join(viewRoot, 'resources', 'backend');
const targetDir = path.join(viewRoot, 'src-tauri', 'resources', 'backend');
const iconSource = path.join(viewRoot, 'assets', 'icon.png');
const iconTarget = path.join(viewRoot, 'src-tauri', 'icons', 'icon.png');

if (!fs.existsSync(path.join(sourceDir, 'backend.exe'))) {
  throw new Error(`找不到后端资源目录: ${sourceDir}`);
}
if (!fs.existsSync(iconSource)) throw new Error(`找不到应用图标: ${iconSource}`);
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
fs.mkdirSync(path.dirname(iconTarget), { recursive: true });
fs.copyFileSync(iconSource, iconTarget);
console.log(`已准备 Tauri backend 资源: ${path.relative(viewRoot, targetDir)}`);
