/*
 * modal.js — 通用弹窗组件：标题 + 内容 + 确定/取消。onOk 返回 false 时不关闭（用于校验失败）。
 */
window.Modal = (function () {
  'use strict';

  function open(opts) {
    const root = document.getElementById('modal-root');
    close();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal';

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = opts.title || '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { close(); if (opts.onCancel) opts.onCancel(); });
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    if (opts.onCancel) {
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = opts.cancelText || '取消';
      cancel.addEventListener('click', function () { close(); opts.onCancel(); });
      footer.appendChild(cancel);
    }
    if (opts.okText !== false) {
      const ok = document.createElement('button');
      ok.className = 'btn btn-primary';
      ok.textContent = opts.okText || '确定';
      ok.addEventListener('click', function () {
        const res = opts.onOk ? opts.onOk(body) : true;
        if (res !== false) close();
      });
      footer.appendChild(ok);
    }

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); if (opts.onCancel) opts.onCancel(); }
    });
    root.appendChild(overlay);
    return body;
  }

  function close() {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
  }

  return { open: open, close: close };
})();
