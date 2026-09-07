import { runTests } from './vision.test.js';
import { runUITests } from './ui.test.js';
document.getElementById('run-tests').onclick = async () => {
  const button = document.getElementById('run-tests'), list = document.getElementById('test-results'), summary = document.getElementById('test-summary');
  button.disabled = true; list.replaceChildren(); summary.textContent = 'Tests en cours…';
  try {
    const append = result => { const item = document.createElement('li'); item.textContent = `${result.pass ? '✓' : 'ÉCHEC'} ${result.name}${result.error ? ` : ${result.error}` : ''}`; list.append(item); };
    const results = await runTests(append);
    try {
      const files = await Promise.all(['../app.js', '../index.html'].map(async path => { const response = await fetch(path); if (!response.ok) throw new Error('Fichier de test inaccessible.'); return response.text(); }));
      const html = new DOMParser().parseFromString(files[1], 'text/html');
      const nodes = [...html.querySelectorAll('[id],button,input,select')].map(node => ({ tag: node.tagName.toLowerCase(), ...Object.fromEntries([...node.attributes].map(a => [a.name, a.value])) }));
      await runUITests(files[0], nodes);
      const ui = { name: '12 contrôles des interactions avec DOM simulé', pass: true }; results.push(ui); append(ui);
    } catch (error) { const ui = { name: 'Interactions avec DOM simulé', pass: false, error: error.message }; results.push(ui); append(ui); }
    summary.textContent = `${results.filter(r => r.pass).length} / ${results.length} tests réussis.`;
  } catch (error) { summary.textContent = `Les tests n’ont pas pu se terminer : ${error.message}`; }
  finally { button.disabled = false; }
};
