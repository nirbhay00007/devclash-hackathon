const { extractGraph } = require('./src/core/parser');

const target = 'C:/techfiesta/mindease-app';
console.log(`Extracting graph for: ${target}`);
const nodes = extractGraph(target);
console.log(`Found ${nodes.length} nodes`);
if (nodes.length > 0) {
    console.log(nodes[0].id);
} else {
    console.log('NO FILES FOUND!');
}
