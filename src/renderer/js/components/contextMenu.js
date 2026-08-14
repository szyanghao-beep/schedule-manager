/*
 * contextMenu.js — 自定义右键菜单。
 * 用法：ContextMenu.show(e.clientX, e.clientY, [{label, onClick, danger?}, '-', ...])
 */
window.ContextMenu = (function () {
  'use strict';
  let el = null;

  function close() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  function show(x, y, items) {
    close();
    el = document.createElement('div');
    el.className = 'context-menu';
    items.forEach(function (it) {
      if (it === '-') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-sep';
        el.appendChild(sep);
        return;
      }
      const item = document.createElement('div');
      item.className = 'context-menu-item' + (it.danger ? ' danger' : '');
      item.textContent = it.label;
      item.addEventListener('click', function () { close(); if (it.onClick) it.onClick(); });
      el.appendChild(item);
    });
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    let px = x, py = y;
    if (px + rect.width > window.innerWidth) px = window.innerWidth - rect.width - 4;
    if (py + rect.height > window.innerHeight) py = window.innerHeight - rect.height - 4;
    el.style.left = px + 'px';
    el.style.top = py + 'px';
  }

  document.addEventListener('click', close);
  document.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  return { show: show, close: close };
})();
