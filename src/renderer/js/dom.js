/*
 * dom.js — 轻量 DOM 工具：创建元素、清空节点、读取表单字段。
 */
window.Dom = (function () {
  'use strict';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // 读取容器内所有 [data-field] 控件的值，checkbox 取 checked
  function readForm(root) {
    const data = {};
    root.querySelectorAll('[data-field]').forEach(function (input) {
      data[input.dataset.field] = (input.type === 'checkbox') ? input.checked : input.value;
    });
    return data;
  }

  return { el: el, clear: clear, readForm: readForm };
})();
