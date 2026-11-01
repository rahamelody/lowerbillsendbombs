// Moves the reviewed quotes in data/quote-queue.json into data/statements.json (the hand-checked quotes that show first on each card).
// Every queued quote is verbatim, dated and linked to the article it came from; nothing is paraphrased.
//   node scripts/apply-quotes.mjs          apply everything in the queue
//   node scripts/apply-quotes.mjs --dry    just list what would be added
import { readJSON, writeJSON, DATA } from './lib.mjs';

const dry = process.argv.includes('--dry');
const queue = readJSON(`${DATA}/quote-queue.json`, { entries: {} });
const st = readJSON(`${DATA}/statements.json`, { entries: {} });
let added = 0, dup = 0;
for (const [key, e] of Object.entries(queue.entries)) {
  for (const topic of ['iran', 'israel', 'health', 'housing']) for (const quote of e[topic] || []) {
    const slot = ((st.entries[key] ||= {})[topic] ||= { quotes: [] });
    if ((slot.quotes ||= []).some(x => x.text === quote.text)) { dup++; continue; }
    slot.quotes.push(quote); added++;
    console.log(`${dry ? 'would add' : 'added'}  ${e.name} · ${topic}: “${quote.text.slice(0, 80)}”`);
  }
}
if (!dry) writeJSON(`${DATA}/statements.json`, st);
console.log(`${added} quotes ${dry ? 'would be added' : 'added'}, ${dup} already there`);
