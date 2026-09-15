setTimeout(() => {
  document.querySelectorAll('button.row-link')[0]?.click();
  [...document.querySelectorAll('.actions button')].find((b) => b.textContent.includes('folder'))?.click();
  setTimeout(() => { document.title = JSON.stringify(window.copied); }, 100);
}, 600);
