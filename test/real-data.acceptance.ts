import { writeFile } from 'node:fs/promises';
import { collectRealDataProof } from './real-data-proof.ts';

const proof = await collectRealDataProof();
await writeFile('docs/real-data-receipt.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ questions: proof.questions.length, totals: proof.totals }));
