import { CHANGELOG, filterChangelog } from '../shared/changelog.js';
import { bindThemeToggle } from '../shared/theme.js';

bindThemeToggle(document.getElementById('theme'));

const code = new URLSearchParams(window.location.search).get('g');
document.getElementById('all').hidden = !code;
const entries = filterChangelog(CHANGELOG, code);
const container = document.getElementById('entries');
let date;
let section;

for (const entry of entries) {
  if (entry.date !== date) {
    date = entry.date;
    section = document.createElement('section');
    section.className = 'changelog-date';
    const heading = document.createElement('h2');
    const time = document.createElement('time');
    time.dateTime = date;
    time.textContent = date;
    heading.append(time);
    section.append(heading);
    container.append(section);
  }

  const article = document.createElement('article');
  article.className = 'changelog-entry';
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const list = document.createElement('ul');
  for (const item of entry.items) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'changelog-label';
    label.textContent = `${item.scope}/${item.kind}:`;
    row.append(label, document.createTextNode(item.text));
    list.append(row);
  }
  article.append(title, list);
  section.append(article);
}
