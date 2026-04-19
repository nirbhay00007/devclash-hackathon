import { Project } from 'ts-morph';
import fs from 'fs';
import path from 'path';

function walk(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'build') return;
        
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (/\.(js|jsx|ts|tsx)$/.test(file)) {
                results.push(file);
            }
        }
    });
    return results;
}

const target = 'C:/techfiesta/mindease-app';
const allExtractedFiles = walk(target);

console.log('Walker found:', allExtractedFiles.length);

const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 }
});

for (const file of allExtractedFiles) {
    project.addSourceFileAtPath(file);
}

console.log('TS-Morph added:', project.getSourceFiles().length);
