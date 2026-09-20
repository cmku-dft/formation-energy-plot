const fs = require('node:fs');
fs.rmSync('.pages-output', {recursive:true,force:true});
fs.mkdirSync('.pages-output');
for(const path of ['index.html','app.js','defect-formation-explorer.html']) fs.copyFileSync(path,`.pages-output/${path}`);
fs.writeFileSync('.pages-output/.nojekyll','');
