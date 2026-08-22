/*
 * toast.js — 轻提示组件。
 */
window.Toast = (function () {
  'use strict';

  function show(msg, type) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('hide'); }, 2200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  return {
    show: show,
    info: function (m) { show(m); },
    success: function (m) { show(m, 'success'); },
    error: function (m) { show(m, 'error'); },
    warning: function (m) { show(m, 'warning'); },
  };
})();
