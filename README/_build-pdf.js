/*
 * _build-pdf.js — 用 Electron 把 HTML 渲染成 PDF（A4、保留背景色）。
 * 用法：npx electron README/_build-pdf.js <html文件> <输出pdf>
 * 说明：仅用于生成宣传资料/用户手册/考卷等静态文档，不属于应用本体。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [htmlPath, outPath] = process.argv.slice(2);
if (!htmlPath || !outPath) {
  console.error('用法: electron _build-pdf.js <html> <out.pdf>');
  process.exit(1);
}

const htmlFile = path.resolve(htmlPath);
const outFile = path.resolve(outPath);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1414,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(htmlFile);
  // 等待字体 / 图片 / SVG 就绪
  await new Promise((r) => setTimeout(r, 800));
  const buf = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true,
  });
  fs.writeFileSync(outFile, buf);
  console.log('已生成:', outFile, '(' + buf.length + ' bytes)');
  app.quit();
}).catch((e) => {
  console.error('PDF 生成失败:', e);
  process.exit(1);
});
