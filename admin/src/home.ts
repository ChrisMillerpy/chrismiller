// The admin home screen: one card per feature.
import { page } from './layout.ts';

interface Card {
  id: string;
  title: string;
  sub: string;
  icon: string;
  href: string;
}

// Add new features here. External links open in a new tab; internal ones in place.
const CARDS: Card[] = [
  { id: 'cathy', title: 'Cathy', sub: 'Sessions with your tutor agent', icon: 'chat', href: '/cathy' },
  { id: 'artifacts', title: 'Artifacts', sub: 'Files Cathy made, private or shared', icon: 'file', href: '/artifacts' },
  { id: 'codebase', title: 'Codebase', sub: 'chrismiller on GitHub', icon: 'code', href: 'https://github.com/ChrisMillerpy/chrismiller' },
  { id: 'packs', title: 'Evidence packs', sub: 'Proof that each change works', icon: 'pack', href: '/packs/' },
];

const ICONS: Record<string, string> = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  pack: '<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
};

const cardHtml = (c: Card) => {
  const external = /^https?:/.test(c.href);
  return `
  <a class="card" href="${c.href}" data-id="${c.id}"${external ? ' target="_blank" rel="noopener"' : ''}>
    <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[c.icon]}</svg></span>
    <span class="txt"><span class="t">${c.title}</span><span class="s">${c.sub}</span></span>
  </a>`;
};

const CSS = `
  .grid { display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
  @media (min-width:700px) { .grid { grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:16px; } }
  .card {
    all:unset; box-sizing:border-box; cursor:pointer; user-select:none; -webkit-user-select:none;
    display:flex; flex-direction:column; justify-content:space-between; gap:20px;
    min-height:140px; padding:16px; border-radius:14px;
    background:var(--bg); border:1px solid var(--line); box-shadow:var(--shadow);
    transition: transform .12s ease, border-color .12s ease;
  }
  @media (min-width:700px) { .card { min-height:160px; padding:20px; } }
  .card:active { transform:scale(.97); }
  @media (hover:hover) { .card:hover { border-color:var(--cobalt); } }
  .card:focus-visible { outline:2px solid var(--cobalt); outline-offset:3px; }
  .ic { width:44px; height:44px; border-radius:10px; background:var(--cobalt-soft); color:var(--cobalt); display:grid; place-items:center; }
  .ic svg { width:22px; height:22px; }
  .txt { display:flex; flex-direction:column; gap:2px; }
  .t { font-family:var(--display); font-size:19px; font-weight:600; }
  .s { font-size:14px; color:var(--muted); }
`;

export const homePage = () =>
  page({
    title: 'Admin',
    css: CSS,
    body: `<main>
  <p class="eyebrow">Admin</p>
  <h1>Hi Chris</h1>
  <div class="grid">${CARDS.map(cardHtml).join('')}</div>
</main>`,
  });
